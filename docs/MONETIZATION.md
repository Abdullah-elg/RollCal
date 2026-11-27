# How RollCal should make money (v3, 26 Nov 2026)

## The answer in one paragraph
Stay **freemium**: guests are how RollCal grows, so everything a guest touches stays free.
Hosts pay for the moments that matter, priced by the **value** of the event, not by what it
costs us to run. There are two ways to pay, and each fits a different kind of host:
- **RollCal Plus**, a subscription for people who host often. It's cheap per event and sold
  on the yearly plan.
- **Event Passes**, one-offs for a single big night: Party ($5.99, 75 people), Big Day
  ($19.99, 300) and Unlimited ($29.99, no limit). The price grows with the size of the event,
  because a wedding is worth far more to the host than a dinner.

The free tier keeps every small hangout (up to 10 people) complete, so free users never feel
squeezed.

## What the data says (RevenueCat, State of Subscription Apps 2026, mostly 2025 data)
- **Freemium converts less, but keeps people just as well.** Median download-to-paid by day 35
  is **2.1%** for freemium apps (top quarter **4.5%+**) and **10.7%** for hard paywalls. Year-one
  retention is about the same for both. A hard paywall would kill invites, so freemium is
  right for us. Aim for top-quarter conversion by asking at the right moments.
- **Most people decide early.** About a third of conversions happen on day 0 and **60%+ within a
  week**. For freemium apps, though, **23% come 6+ weeks after download**. Our "aha" is the
  first event's photos, so the key moment is the morning after an event.
- **Longer trials convert better.** Median trial-to-paid is **37.4%** for 5–9 day trials and
  **42.5%** for 17–32 days. Photo & Video apps sit lower, at **22.2%**.
- **Yearly plans keep people.** Year-one retention is about **28–31%** for yearly plans against
  **8–10%** for monthly. The median yearly price is about **$34.80**, and Social apps sit around
  **$9.99/month**.
- **Hybrid pricing is common in our category.** **23%** of apps add a lifetime purchase and
  **11%** add consumables, and Photo & Video apps lead on combining plans with one-off buys.
  Plus with an Event Pass is a normal, proven setup.

## The tiers (v4: free capped at 10 people, Unlimited Pass added)
The full feature-by-plan list is in **docs/PLANS.md**.

| | **Free** | **Party Pass** | **Big Day Pass** | **Unlimited Pass** | **RollCal Plus** |
|---|---|---|---|---|---|
| Who buys it | n/a | the host, for one event | the host, for one event | the host, for one event | anyone (subscription) |
| People per event | **10** | 75 | 300 | **unlimited** | 100 on every event you host |
| Photos per event | 200 | unlimited | unlimited | unlimited | unlimited |
| Photos kept | 30 days (Save all always free) | forever | forever | forever | forever |
| Video recap | 5-second preview | ✓ everyone in the event | ✓ | ✓ | ✓ |
| Storage (fair use) | 2 GB per account | 10 GB for the event | 30 GB | 60 GB | 50 GB per account |
| Price | $0 | **$5.99** | **$19.99** | **$29.99** | **$4.99/mo or $34.99/yr** |

**On 10 free people.** This makes the free tier a "small hangout" tier: dinners, game nights,
small birthdays. Bigger events (most birthdays, every party) become paid, so conversion will be
noticeably higher than at 25 people. The risk is growth: every event that hits the cap is one
where 11+ people would have met RollCal. To soften that:
- **Count only "going" people,** never invitees. Anyone can still open the link and see the event.
- **Let person 11 see the event** and get "This event is full. We've let the host know." They're
  never blocked from installing the app or hosting their own event.
- **Watch invites per event and guest-to-host conversion.** If they drop more than about 10%,
  test 15.

Plus members get **passes 30% off** (Big Day $13.99, Unlimited $20.99) for the times they need more
than 100 people.

## Should storage be capped on Plus and the passes? Yes, as fair use
"Forever" plus "unlimited" bought once is the one way RollCal could lose money. Storage on
Cloudflare R2 costs about **$0.015 per GB a month** (delivery is free), and kept-forever storage is
paid for every month for years.
- **Real events are small.** A phone photo is about 2–4 MB after upload, so a 300-person wedding
  with 3,000 photos and a few videos is about **10–15 GB**. A dinner with 80 photos is **0.3 GB**.
- **What a full cap costs per year:** Party 10 GB is **$1.80/yr**, Big Day 30 GB **$5.40/yr** and
  Unlimited 60 GB **$10.80/yr**. Plus at 50 GB is **$9/yr** against $34.99/yr. Even at their caps,
  passes pay for 3+ years, and almost nobody gets near the cap.
- **Show photos, not GB:** "Room for about 20,000 photos". Show a warning at 80%, and later
  offer "+50 GB for $1.99/mo" as an add-on rather than a hard wall.
- **Free's 2 GB recycles on its own,** because free events' photos go after 30 days.
- **Video is what fills storage.** Videos are capped at 15 s free and 1 min paid, and compressed
  on upload, which is the main protection.
- Today's 250 GB on Pro goes away with Pro; existing Pro users keep it (grandfathered).

## Bill splitting: keep it free, charge only for the AI and the automation
Settling up involves every guest, and guests must stay free. It's also a big reason people use
RollCal for *every* event, which is what makes them hosts (and payers) later. Charging to split
a bill would feel greedy and hurt growth.
- **Free for everyone:**
  - Creating a bill (typed lines), splitting by item or evenly, and claiming what you had.
  - Seeing what you owe, payment handles, marking paid and confirming payments.
  - Live updates, currency conversion, and a reminder every 12 hours.
- **AI receipt scanning** costs us per scan and saves real time:
  - Free: **3 a month**.
  - Passes: **+5 for that event**.
  - Plus: **unlimited**.
- **Plus extras (to build):**
  - **Auto-reminders:** RollCal nudges people who haven't paid, so the host doesn't have to be
    the bad guy.
  - **"Settle the whole event":** one total per person across every bill in the event.
  - **Export to CSV or PDF**, for trips and team events.

RollCal never touches the money (people pay each other through their own apps), so there's no
payment-processing revenue to chase, and none of the regulation that would come with it.

## Never charged for (the free experience is protected)
- Joining, viewing, uploading to, reacting in or chatting in any event.
- Saving photos to your phone, the picture recap, invites and reminders.
- Privacy, safety, data export and account deletion.
- **No ads, ever.** No fake timers, no nagging every session, and nothing that's free today is
  taken away.

## When to ask (moments of real intent, at most once a session)
1. **The morning after (strongest).** "Your recap is ready." The 5-second preview plays, then:
   "Start a 7-day free trial of Plus" or "Unlock this event: $5.99".
2. **The event is filling up.** At 80% ("8 of 10 people") the host gets a gentle note. At 100%
   it offers the Party Pass. The person trying to join is never asked to pay; they're told "the
   host has been let know".
3. **"Expiring soon".** Already built: keep this one forever with a pass, or every event with Plus.
4. **Receipt scans run out.** The prompt already exists.
5. Always available: "Plans" in Settings and the Plus row on the profile.

Back off after a dismissal (don't show the same prompt again for 7 days), and never show a
payment prompt to a guest.

## The paywall screen
- The headline is the outcome: "Keep every night, and relive it in a minute."
- Lead with what this person just did: from an event, show that event's 5-second recap preview
  in motion.
- Pre-select the yearly plan with a "Best value" label, keep monthly visible, and show the trial
  terms and renewal date next to the button. Include "Not now", Restore, Terms and Privacy.
- Prices are localised by the stores, with `priceText()` showing the guide in the person's
  currency.

## Rough maths (to sanity-check, not a forecast)
**Assumptions,** per 10,000 hosts who create an event in their first month:
- **Plus:** 3% (above the freemium median, below the top quarter) at a ~$30 blended yearly price,
  about **$9,000/yr**.
- **Passes:** with the 10-person cap, about 6% of hosts buy one or two a year at ~$9 average,
  about **$7,000/yr**.

**Total:** about **$16k a year per 10k hosts** before store fees (15% for small businesses on
both stores).

**Costs** are under 1% of that: R2 storage, AI captions at ~0.02¢ a photo, and Supabase. The
pricing is set by value. Cost only guarantees we never lose money on a user.

## Experiments (one at a time, with enough users to trust the result)
1. **Trial length:** 7 vs 14 days (the data suggests longer trials convert better).
2. **Plus yearly price:** $29.99 vs $34.99 vs $39.99.
3. **Party Pass price:** $4.99 vs $5.99 vs $7.99.
4. **Free people limit:** 10 vs 15 vs 20. **Guardrail:** invites per event and guest-to-host
   conversion must not drop.
5. **The 5-second preview** vs no preview (expect the preview to win).

## What to build, in order
1. **Server limits:**
   - `event_limits` (people and photos from the host's plan and any pass), with checks in join,
     accept and the photo insert rule.
   - Passes and Plus keep photos forever (the expiry job).
   - `event_passes` with a tier (party, big_day), written only by the RevenueCat webhook.
2. **RevenueCat:**
   - Plus monthly and yearly, with the 7-day trial on yearly.
   - Party, Big Day and Unlimited Pass as consumables bought for a specific event.
3. **App:**
   - Remove Pro from the plans screen and grandfather existing Pro users.
   - The people and photo meters, and the full-event screens (separate ones for host and guest).
   - The 5-second preview lock on the video recap.
   - "Unlocked by …" on passed events.
   - One paywall that opens on the right offer for where you came from.
4. **Measure:**
   - Paywall views and conversion per moment.
   - Trial starts, trial-to-paid, and the yearly/monthly mix.
   - Passes per event, and refunds.
   - Free retention and invites, as the guardrail.
5. **Legal before launch:** auto-renewal terms, easy cancel, trial reminders, pass refunds
   through the stores. Run legal-compliance-check.

## What changes from what's in the app today
- **Plans:** today it's Basic, Plus, Pro ($6.99) and Event Pass ($2.99). It becomes Free, Plus,
  Party Pass, Big Day Pass and Unlimited Pass.
- **Free photo retention:** the code says "1 year" in `pro.ts` but 30 days in `expiry.sql`. Make
  both say 30 days.
- **Video recap for free users:** today it's fully locked. It becomes a 5-second preview, then
  the lock.
