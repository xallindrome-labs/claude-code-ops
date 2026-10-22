export const meta = {
  name: 'leak-finder',
  description: 'Find where a small business loses leads and time, from its public website only, with evidence for every claim',
  whenToUse: 'To prepare a diagnostic for a small business (your own, a client who agreed, or a prospect). Public pages only; no logins, no form submissions.',
  phases: [
    { title: 'Inspect', detail: 'one inspector per area per site, in parallel' },
    { title: 'Verify', detail: 'a skeptic re-opens the page for every medium/high leak' },
    { title: 'Report', detail: 'one leak report per site, plus questions for the diagnostic' },
  ],
}

// args: {
//   sites: [{ name: string, url: string, notes?: string }]   (required)
//   areas?: string[]                  subset of the areas below
//   models?: { inspect?: string, verify?: string } | null
// }
// Rules baked into every prompt: public pages only, never log in, never submit a form, never contact anyone,
// cite a URL and a quoted snippet for every observation, and say "could not verify" instead of guessing.
const sites = args?.sites
if (!Array.isArray(sites) || !sites.length) throw new Error('leak-finder needs args.sites: [{ name, url }]')
const models = args?.models === null ? {} : { inspect: 'sonnet', verify: 'sonnet', ...(args?.models ?? {}) }
const m = s => (models[s] ? { model: models[s] } : {})

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
  properties: { holdsUp: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['holdsUp', 'reason'],
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
  'Do not edit files. Every observation needs a URL and a quoted snippet or precise description. If you cannot see something, put it under couldNotVerify; never guess. ' +
  'Judge the business\'s systems, not the people. Be fair: report what is working too by omitting nothing that contradicts a leak.'

const perSite = await pipeline(
  sites,
  site => parallel(wanted.map(area => () => agent(
    `${RULES}\n\nBusiness: ${site.name}\nWebsite: ${site.url}\n${site.notes ? `Notes from the owner: ${site.notes}\n` : ''}\n` +
    `Area to inspect: ${area}.\n${AREAS[area]}\n\nFetch the site's relevant pages (home, contact, booking/services, a couple of internal pages) and report leaks in this area.`,
    { label: `inspect:${site.name}:${area}`, phase: 'Inspect', schema: LEAKS, ...m('inspect') }))),
  async (areaResults, site) => {
    const got = areaResults.filter(Boolean)
    if (got.length < wanted.length) log(`${site.name}: ${wanted.length - got.length} area inspector(s) failed`)
    const leaks = got.flatMap(r => r.leaks.map(l => ({ ...l, area: r.area })))
    const unverified = got.flatMap(r => r.couldNotVerify.map(x => `${r.area}: ${x}`))
    const toCheck = leaks.filter(l => l.impact !== 'low')
    const lowCount = leaks.length - toCheck.length
    if (lowCount) log(`${site.name}: ${lowCount} low-impact leak(s) reported without a second check`)
    const checked = (await parallel(toCheck.map(l => () => agent(
      `${RULES}\n\nTry to REFUTE this claim about ${site.name} (${site.url}) by opening the cited page yourself.\n` +
      `Claim: ${l.title}\nObservation: ${l.observation}\nEvidence URL: ${l.evidenceUrl}\nQuote: ${l.evidenceQuote}\n` +
      'holdsUp=true only if you see it yourself, now, on that page. If the page changed, is missing, or you are unsure, holdsUp=false.',
      { label: `verify:${site.name}:${l.title.slice(0, 30)}`, phase: 'Verify', schema: VOTE, ...m('verify') })
        .then(v => ({ ...l, holdsUp: v ? v.holdsUp : false, verifyNote: v ? v.reason : 'verifier failed' }))))).filter(Boolean)
    const confirmed = [...checked.filter(l => l.holdsUp), ...leaks.filter(l => l.impact === 'low')]
    const refuted = checked.filter(l => !l.holdsUp)
    if (refuted.length) log(`${site.name}: ${refuted.length} leak(s) did not hold up on re-check: ${refuted.map(l => l.title).join('; ')}`)
    const report = await agent(
      `Write the leak report for ${site.name} (${site.url}).\nConfirmed leaks (each re-checked against the live page):\n${JSON.stringify(confirmed, null, 1)}\n\n` +
      `Could not verify: ${JSON.stringify(unverified)}\nRefuted on re-check (do not report): ${JSON.stringify(refuted.map(l => l.title))}\n\n` +
      'Give: the top 3 leaks by impact (plain language, no jargon, one sentence on what it likely costs the business, hedged honestly), quick wins that need no software, ' +
      'and 5 questions to ask the owner in a diagnostic call to size the real problem (hours per week, lead volume, response time). ' +
      'Never state a dollar figure you cannot support. Add the evidence URL next to each claim.',
      { label: `report:${site.name}`, phase: 'Report', schema: REPORT })
    return { site: site.name, url: site.url, confirmed, refuted: refuted.map(l => l.title), unverified, report }
  })

return { sites: perSite.filter(Boolean), skipped: sites.length - perSite.filter(Boolean).length }
