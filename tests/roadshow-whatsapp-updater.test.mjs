import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../google-apps-script/RoadshowWhatsAppUpdater.gs', import.meta.url), 'utf8')

function sheet(name, rows) {
  return {
    getName: () => name,
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange: (startRow, startColumn, rowCount, columnCount) => ({
      getValues: () => rows.slice(startRow - 1, startRow - 1 + rowCount)
        .map((row) => row.slice(startColumn - 1, startColumn - 1 + columnCount)),
      getDisplayValues: () => rows.slice(startRow - 1, startRow - 1 + rowCount)
        .map((row) => row.slice(startColumn - 1, startColumn - 1 + columnCount)
          .map((value) => String(value ?? ''))),
    }),
  }
}

function setup({ now = '2026-09-14T04:00:00Z', whapiStatus = 200, previousCounts = {} } = {}) {
  const schedule = sheet('Master Roadshow Listing', [
    ['State', 'Roadshow Venue', 'Start Date', 'End Date'],
    ['', 'Lotus E-Gate', '21/4/2026', '23/4/2026'],
    ['', 'Lotus E-Gate', '14/9/2026', '16/9/2026'],
    ['', 'Food Bayana', '18/9/2026', '6/11/2026'],
    ['', 'Sunway Medical Center', '', ''],
  ])
  const ge = sheet('GE Survey Form', [
    ['Date', 'Roadshow Location'],
    ['2026-04-22', 'Lotus E-Gate'],
    ['2026-09-14', 'Lotus E-Gate'],
    ['2026-09-16', 'Lotus E-Gate'],
    ['2026-09-18', 'Food Bayana'],
  ])
  const hospital = sheet('Hospital Survey', [
    ['Date', 'Roadshow Location'],
    ['2026-09-15', 'Lotus E-Gate'],
    ['2026-09-16', 'Lotus E-Gate'],
    ['2026-09-14', 'Other Roadshow'],
  ])
  const sheets = new Map([schedule, ge, hospital].map((value) => [value.getName(), value]))
  const properties = new Map([
    ['WHAPI_TOKEN', 'test-token'],
    ['WHAPI_CHAT_ID', 'test-group@g.us'],
    ...Object.entries(previousCounts),
  ])
  const messages = []
  const RealDate = Date
  class FixedDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])) }
  }
  const context = {
    Date: FixedDate,
    SpreadsheetApp: { openById: () => ({ getSheetByName: (name) => sheets.get(name) }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties.get(key),
      setProperty: (key, value) => properties.set(key, value),
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
    Utilities: { formatDate: (value, _zone, format) => {
      if (format === 'yyyy-MM-dd') return value.toISOString().slice(0, 10)
      return '14 Sep, 12:00 pm'
    } },
    UrlFetchApp: { fetch: (_url, request) => {
      messages.push(JSON.parse(request.payload).body)
      return { getResponseCode: () => whapiStatus, getContentText: () => 'mock response' }
    } },
    Logger: { log() {} },
    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create() {} }) }) }),
      deleteTrigger() {},
    },
  }
  vm.createContext(context)
  vm.runInContext(source, context)
  return { context, sheets, properties, messages }
}

test('separate runs of one venue use their own inclusive start and end dates across both forms', () => {
  const { context, sheets } = setup()
  const schedule = context.readRoadshowSchedule_({ getSheetByName: (name) => sheets.get(name) })
  const today = context.parseRoadshowDate_('2026-09-14')
  const active = schedule.filter((run) => run.startDay <= today && today <= run.endDay + 3)
  const tabs = ['GE Survey Form', 'Hospital Survey'].map((name) => ({
    sheet: sheets.get(name), total: sheets.get(name).getLastRow() - 1, previous: 0,
  }))
  const counts = context.countLeadsForRuns_(tabs, active)

  assert.equal(active.length, 1)
  assert.equal(active[0].scheduleRow, 3)
  assert.equal(counts[3].total, 4)
  assert.equal(counts[3].new, 4)
  assert.equal(counts[2], undefined)
})

test('status and breakdown keep an ended run for three days, then remove it', () => {
  const { context, sheets } = setup()
  const schedule = context.readRoadshowSchedule_({ getSheetByName: (name) => sheets.get(name) })
  const selected = (date) => context.selectRoadshowStatuses_(schedule, context.parseRoadshowDate_(date))
  const active = (date) => schedule.filter((run) => {
    const day = context.parseRoadshowDate_(date)
    return run.startDay <= day && day <= run.endDay + 3
  })

  assert.equal(selected('2026-09-16')[0].status, 'Ongoing')
  assert.equal(selected('2026-09-17')[0].status, 'Recently ended (day 1 of 3)')
  assert.equal(selected('2026-09-19').some((item) => item.run.scheduleRow === 3), true)
  assert.equal(selected('2026-09-20').some((item) => item.run.scheduleRow === 3), false)
  assert.equal(active('2026-09-19').some((run) => run.scheduleRow === 3), true)
  assert.equal(active('2026-09-20').some((run) => run.scheduleRow === 3), false)
  assert.equal(selected('2026-09-14').some((item) => item.run.scheduleRow === 4), true)
  assert.equal(schedule.some((item) => item.venue === 'Sunway Medical Center'), false)
})

test('date parser accepts Sheet-style dates and rejects invalid calendar dates', () => {
  const { context } = setup()
  assert.equal(context.parseRoadshowDate_('14/9/2026'), context.parseRoadshowDate_('2026-09-14'))
  assert.equal(context.parseRoadshowDate_('31/2/2026'), null)
})

test('successful send reports all-time totals but only current-run location counts', () => {
  const { context, properties, messages } = setup()
  context.sendRoadshowUpdate()

  assert.equal(messages.length, 1)
  assert.match(messages[0], /Total leads: \*7\*/)
  assert.match(messages[0], /New since last update: \*\+7\*/)
  assert.match(messages[0], /Roadshow Status \(recent 4\)/)
  assert.match(messages[0], /Lotus E-Gate \(14\/9\/2026–16\/9\/2026\): 4 total \(\+4 new\)/)
  assert.doesNotMatch(messages[0], /21\/4\/2026–23\/4\/2026/)
  assert.doesNotMatch(messages[0], /By Survey/)
  assert.equal(properties.get('lastCount_GE Survey Form'), '4')
  assert.equal(properties.get('lastCount_Hospital Survey'), '3')
})

test('per-roadshow increase uses the same successful-send row baselines as general new leads', () => {
  const { context, messages, properties } = setup({ previousCounts: {
    'lastCount_GE Survey Form': '2',
    'lastCount_Hospital Survey': '1',
  } })

  context.sendRoadshowUpdate()

  assert.match(messages[0], /New since last update: \*\+4\*/)
  assert.match(messages[0], /Lotus E-Gate \(14\/9\/2026–16\/9\/2026\): 4 total \(\+2 new\)/)
  assert.equal(properties.get('lastCount_GE Survey Form'), '4')
  assert.equal(properties.get('lastCount_Hospital Survey'), '3')
})

test('failed Whapi send leaves baselines unchanged for next run', () => {
  const failed = setup({ whapiStatus: 500 })
  assert.throws(() => failed.context.sendRoadshowUpdate(), /Whapi send failed/)
  assert.equal(failed.properties.has('lastCount_GE Survey Form'), false)
  assert.equal(failed.properties.has('lastCount_Hospital Survey'), false)

  const retry = setup()
  retry.context.sendRoadshowUpdate()
  retry.context.sendRoadshowUpdate()
  assert.equal(retry.messages.length, 1)
})
