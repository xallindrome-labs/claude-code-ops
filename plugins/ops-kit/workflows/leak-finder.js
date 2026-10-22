export const meta = {
  name: 'leak-finder',
  description: 'Find where a small business loses leads and time, from its public website only, with evidence for every claim',
  whenToUse: 'To prepare a diagnostic for a small business (your own, a client who agreed, or a prospect). Public pages only; no logins, no form submissions.',
  phases: [
    { title: 'Inspect', detail: 'one inspector per area per site, in parallel' },
    { title: 'Verify', detail: 'merge duplicate leaks, then a skeptic re-opens the page for the most important ones' },
    { title: 'Report', detail: 'one leak report per site, plus questions for the diagnostic' },
  ],
}

// args: {
//   sites: [{ name: string, url: string, notes?: string }]   (required)
//   areas?: string[]                  subset of the areas below
//   verifyCap?: number                max leaks re-checked per site (default 8, most important first; the rest are listed as not re-checked)
//   dryRun?: boolean                  log the PLAN line and return without running any agent
//   models?: { inspect?: string, verify?: string } | null
// }
// Rules baked into every prompt: public pages only, never log in, never submit a form, never contact anyone,
// cite a URL and a quoted snippet for every observation, and say "could not verify" instead of guessing.
const sites = args?.sites
if (!Array.isArray(sites) || !sites.length) throw new Error('leak-finder needs args.sites: [{ name, url }]')
const models = args?.models === null ? {} : { inspect: 'sonnet', verify: 'sonnet', ...(args?.models ?? {}) }
const m = s => (models[s] ? { model: models[s] } : {})

// ---- cost lines: counts only. Agent counts show the size of a run; tokens and dollars are not estimated here. ----
const NAME = 'leak-finder'
let launched = 0
let failed = 0
const byPhase = {}
const run = async (prompt, opts) => {
  launched++
  const p = opts?.phase ?? 'other'
  byPhase[p] = (byPhase[p] ?? 0) + 1
  const r = await agent(prompt, opts)
  if (r === null || r === undefined) failed++
  return r
}
const receipt = () => ({ launched, failed, byPhase: { ...byPhase } })
const MODEL_NOTE = 'bulk stages use ' + (Object.values(models).filter(Boolean).length ? [...new Set(Object.values(models).filter(Boolean))].join('/') : 'the session model') + '; the final summary uses the session model'
const planLine = (size, knob) => 'PLAN ' + NAME + ': ' + size + '. ' + MODEL_NOTE + '. Smallest knob: ' + knob + '. Agent counts show size, not cost; tokens and dollars are not estimated here.'
const doneLine = extra => 'DONE ' + NAME + ': ' + launched + ' agents launched' + (failed ? ', ' + failed + ' returned nothing' : '') + '. ' + (extra ? extra + ' ' : '') + 'Tokens are not measured here; see your session usage.'

const AREAS = {
  'lead-capture': 'How does a visitor become a lead? Forms, phone/text/chat options, calls to action above the fold on mobile, what happens after submit (confirmation text, promised response time), forms asking for too much.',
  'booking-path': 'Can a visitor book, buy or request a quote without a phone call? Count the steps from landing page to a confirmed booking; note dead ends, PDF intake forms, "call us" only paths, outdated or missing availability.',
  'follow-up': 'Evidence of follow-up: email or SMS capture, newsletter, abandoned-inquiry nurture, reminders, review requests, rebooking prompts, a stated response time. Absence of any capture is itself a leak.',
  'reputation': 'Public reviews (Google, Yelp, industry sites): volume, recency, rating, whether the owner replies, and whether the site shows or links to reviews.',
  'manual-work': 'Signs of manual back-office work visible from outside: forms that email a person, downloadable spreadsheets or PDFs to fill in, "email us your documents", price lists that need a quote, repeated FAQ answered by phone.',
  'basics': 'Obvious basics visible without tools: mobile layout problems, broken links or images, missing business hours/address/phone, no HTTPS, stale copyright year or news, missing Google Business Profile link.',
}
const wanted = (args?.areas ?? Object.keys(AREAS)).filter(a => AREAS[a])
if (!wanted.length) throw new Error('args.areas had no valid entries')

const LEAKS = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    leaks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          observation: { type: 'string' },
          evidenceUrl: { type: 'string' },
          evidenceQuote: { type: 'string', description: 'short exact text or a precise description of what the page shows' },
          impact: { type: 'string', enum: ['high', 'medium', 'low'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          fixIdea: { type: 'string', description: 'the simplest automation or change that would close the leak' },
        },
        required: ['title', 'observation', 'evidenceUrl', 'evidenceQuote', 'impact', 'confidence'],
      },
    },
    couldNotVerify: { type: 'array', items: { type: 'string' } },
  },
  required: ['area', 'leaks', 'couldNotVerify'],
}
const VOTE = {
  type: 'object',
  properties: { holdsUp: { type: 'boolean' }, reason: { type: 'string' }, correction: { type: 'string', description: 'corrected statement when the claim is right in substance but a detail is wrong' } },
  required: ['holdsUp', 'reason'],
}
const DEDUPE = {
  type: 'object',
  properties: {
    groups: { type: 'array', items: { type: 'object', properties: { members: { type: 'array', items: { type: 'integer' } } }, required: ['members'] } },
  },
  required: ['groups'],
}
const REPORT = {
  type: 'object',
  properties: {
    topLeaks: { type: 'array', items: { type: 'string' } },
    quickWins: { type: 'array', items: { type: 'string' } },
    diagnosticQuestions: { type: 'array', items: { type: 'string' } },
    markdown: { type: 'string' },
  },
  required: ['topLeaks', 'quickWins', 'diagnosticQuestions', 'markdown'],
}

const RULES = 'Rules: use only publicly visible pages and public review sites. Never log in, never submit or start a form, never contact the business, never collect personal data about individuals. ' +
  'Do not edit files. Read pages with WebFetch or curl; never use browser or computer-use tools, because they are shared with the other agents running at the same time and pages will change under you. Every observation needs a URL and a quoted snippet or precise description. If you cannot see something, put it under couldNotVerify; never guess. ' +
  'Judge the business\'s systems, not the people. Be fair: report what is working too by omitting nothing that contradicts a leak.'

const IMPACT_RANK = { high: 0, medium: 1, low: 2 }
const CONF_RANK = { high: 0, medium: 1, low: 2 }
const verifyCap = args?.verifyCap ?? 8
const PER_SITE_FLOOR = wanted.length + 2 // inspectors + dedupe + report
log(planLine(
  sites.length * PER_SITE_FLOOR + ' to ' + sites.length * (PER_SITE_FLOOR + verifyCap) + ' agents (' + sites.length + ' site(s); per site ' + wanted.length + ' inspectors, 1 dedupe, up to ' + verifyCap + ' verifiers, 1 report)',
  'args.verifyCap, or fewer args.areas'))
if (args?.dryRun === true) return { dryRun: true, plan: { min: sites.length * PER_SITE_FLOOR, max: sites.length * (PER_SITE_FLOOR + verifyCap) } }

const perSite = await pipeline(
  sites,
  site => parallel(wanted.map(area => () => run(
    `${RULES}\n\nBusiness: ${site.name}\nWebsite: ${site.url}\n${site.notes ? `Notes from the owner: ${site.notes}\n` : ''}\n` +
    `Area to inspect: ${area}.\n${AREAS[area]}\n\nFetch the site's relevant pages (home, contact, booking/services, a couple of internal pages) and report leaks in this area.`,
    { label: `inspect:${site.name}:${area}`, phase: 'Inspect', schema: LEAKS, ...m('inspect') }))),
  async (areaResults, site) => {
    const got = areaResults.filter(Boolean)
    if (got.length < wanted.length) log(`${site.name}: ${wanted.length - got.length} area inspector(s) failed`)
    const raw = got.flatMap(r => r.leaks.map(l => ({ ...l, area: r.area })))
    const unverified = got.flatMap(r => r.couldNotVerify.map(x => `${r.area}: ${x}`))

    // Inspectors work independently, so one underlying problem is often reported in several areas.
    // Merge duplicates BEFORE spending verifiers on them (a genuine cross-item step).
    let leaks = raw.map(l => ({ ...l, areas: [l.area] }))
    if (raw.length > 1) {
      const dd = await run(
        'These leak observations about one website came from independent inspectors and may describe the same underlying problem. ' +
        'Group the ones that are the same problem. Use the 0-based index of each observation. Observations that are unique can be left out.\n' +
        JSON.stringify(raw.map((l, i) => ({ i, area: l.area, title: l.title, evidenceUrl: l.evidenceUrl })), null, 1),
        { label: `dedupe:${site.name}`, phase: 'Verify', schema: DEDUPE, ...m('verify') })
      const used = new Set()
      const merged = []
      for (const g of dd?.groups ?? []) {
        const idx = [...new Set(g.members)].filter(i => Number.isInteger(i) && i >= 0 && i < raw.length && !used.has(i))
        if (!idx.length) continue
        idx.forEach(i => used.add(i))
        const members = idx.map(i => raw[i])
        const best = [...members].sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] || CONF_RANK[a.confidence] - CONF_RANK[b.confidence])[0]
        merged.push({ ...best, areas: [...new Set(members.map(x => x.area))] })
      }
      raw.forEach((l, i) => { if (!used.has(i)) merged.push({ ...l, areas: [l.area] }) })
      if (merged.length < raw.length) log(`${site.name}: ${raw.length} observations merged into ${merged.length} distinct leaks`)
      leaks = merged
    }

    // Verify the most important leaks first, up to the cap. Everything else is reported as "not re-checked".
    const order = [...leaks].sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] || CONF_RANK[a.confidence] - CONF_RANK[b.confidence])
    const toCheck = order.filter(l => l.impact !== 'low').slice(0, verifyCap)
    const notChecked = order.filter(l => !toCheck.includes(l))
    if (notChecked.length) log(`${site.name}: ${notChecked.length} leak(s) not re-checked (low impact or over verifyCap=${verifyCap})`)
    const checked = (await parallel(toCheck.map(l => () => run(
      `${RULES}\n\nTry to REFUTE this claim about ${site.name} (${site.url}) by opening the cited page yourself.\n` +
      `Claim: ${l.title}\nObservation: ${l.observation}\nEvidence URL: ${l.evidenceUrl}\nQuote: ${l.evidenceQuote}\n` +
      'holdsUp=true only if you see it yourself, now, on that page. If the page changed, is missing, or you are unsure, holdsUp=false. ' +
      'If the claim is right in substance but a detail is wrong (a quote, a count, a name), put the corrected statement in `correction`.',
      { label: `verify:${site.name}:${l.title.slice(0, 30)}`, phase: 'Verify', schema: VOTE, ...m('verify') })
        .then(v => ({ ...l, holdsUp: v ? v.holdsUp : false, verifyNote: v ? v.reason : 'verifier failed', correction: v?.correction ?? '' }))))).filter(Boolean)
    const confirmed = checked.filter(l => l.holdsUp)
    const refuted = checked.filter(l => !l.holdsUp)
    if (refuted.length) log(`${site.name}: ${refuted.length} leak(s) did not hold up on re-check: ${refuted.map(l => l.title).join('; ')}`)
    const report = await run(
      `Write the leak report for ${site.name} (${site.url}).\n` +
      `Re-checked leaks (each confirmed against the live page; where "correction" is set, trust it over the original wording):\n${JSON.stringify(confirmed, null, 1)}\n\n` +
      `Also noticed but NOT re-checked (low impact or over the verification cap; list them separately as "also noticed", never in the top 3):\n${JSON.stringify(notChecked.map(l => ({ title: l.title, areas: l.areas, evidenceUrl: l.evidenceUrl, impact: l.impact })), null, 1)}\n\n` +
      `Could not verify: ${JSON.stringify(unverified)}\nRefuted on re-check (do not report): ${JSON.stringify(refuted.map(l => l.title))}\n\n` +
      'Give: the top 3 leaks by impact drawn ONLY from the re-checked list (plain language, no jargon, one sentence on what it likely costs the business, hedged honestly), quick wins that need no software, ' +
      'and 5 questions to ask the owner in a diagnostic call to size the real problem (hours per week, lead volume, response time). ' +
      'Never state a dollar figure you cannot support. Add the evidence URL next to each claim.',
      { label: `report:${site.name}`, phase: 'Report', schema: REPORT })
    return { site: site.name, url: site.url, observed: raw.length, distinct: leaks.length, confirmed, notRechecked: notChecked.map(l => l.title), refuted: refuted.map(l => l.title), unverified, report }
  })

const done = perSite.filter(Boolean)
log(doneLine(done.length + ' site report(s).'))
return { sites: done, skipped: sites.length - done.length, receipt: receipt() }
