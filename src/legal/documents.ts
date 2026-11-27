// The Terms of Service, Plan Terms (RollCal Plus, Event Passes and Pro) and
// Privacy Policy, shown in the app (sign up, Settings, the plans screen). Plain language on purpose.
//
// Before launch: have a lawyer review all three documents, and publish the
// same text at public web addresses (npm run build:legal writes them to
// web/; the App Store and Google Play both ask for a privacy policy URL).

const OPERATOR = 'RollCal';
const CONTACT = 'support@rollcal.app';
const PROVINCE = 'Ontario';
const UPDATED = 'November 27, 2026';

export type LegalDoc = 'terms' | 'pro' | 'privacy';

export type LegalDocument = {
  title: string;
  updated: string;
  intro: string;
  sections: { heading: string; paragraphs: string[] }[];
};

export const LEGAL: Record<LegalDoc, LegalDocument> = {
  terms: {
    title: 'Terms of Service',
    updated: UPDATED,
    intro: `These terms are an agreement between you and ${OPERATOR} (“we”, “us”), who runs RollCal. By creating an account or using the app, you agree to them. If you don’t agree, please don’t use RollCal.`,
    sections: [
      {
        heading: 'Who can use RollCal',
        paragraphs: [
          'You must be at least 13 years old. We ask when you were born when you join (we don’t keep the date), and accounts belonging to anyone under 13 are deleted. If you are under the age of majority where you live, you need a parent or guardian’s permission.',
          'Give accurate details when you sign up, keep your login secure, and tell us if you think someone else is using your account. You are responsible for what happens under your account.',
        ],
      },
      {
        heading: 'Your content',
        paragraphs: [
          'You own the photos, videos, messages and other things you add (“your content”).',
          'So that the app can work, you give us a worldwide, non-exclusive, royalty-free licence to host, store, copy, process and display your content, only to run and improve RollCal. This licence ends when your content is deleted, except for copies we must keep by law or that remain for a short time in backups.',
          'When you add photos or videos to an event, everyone in that event can view, react to, download and save them. Copies people have already saved stay with them even if you later delete yours.',
          'When someone makes a video recap of an event, it is saved with the event so everyone in it can watch, save and share it, and it may include your photos and videos. It is deleted when the event, or any photo or video in it, is deleted or removed.',
          'Only add content you have the right to share, and only share photos or videos of other people when they are comfortable with it.',
        ],
      },
      {
        heading: 'Things you must not do',
        paragraphs: [
          'We have zero tolerance for objectionable content and abusive users. Don’t use RollCal to break the law, harass, threaten or bully anyone, share hateful content, share sexual content involving anyone under 18, share intimate images of anyone without their consent, impersonate others, spam, or upload anything harmful such as malware. Don’t try to access accounts or data that aren’t yours, or copy the app’s data by automated means.',
          'You can block anyone and report people, messages, photos and events in the app. We review reports within 24 hours, and we may remove content or suspend or close accounts that break these rules. We may report illegal content to the authorities.',
        ],
      },
      {
        heading: 'Copyright',
        paragraphs: [
          'Respect other people’s work: don’t add photos, videos or other material you don’t have the right to share.',
          `If you believe something on RollCal infringes your copyright, email ${CONTACT} with your name and contact details, a description of the work, where it appears in RollCal, and a statement that you believe in good faith the use isn’t authorized. We will remove infringing content, forward notices as the law requires, and close the accounts of people who infringe repeatedly.`,
        ],
      },
      {
        heading: 'Plans, limits and storage',
        paragraphs: [
          'RollCal is free to use. On the free plan, an event can have up to 10 people (counting the host and everyone going) and 200 photos and videos, videos can be up to 15 seconds long, each account can store up to 2 GB, and an event’s photos and videos are kept for 30 days after it ends. The app warns you before they are deleted.',
          'RollCal Plus and Event Passes raise these limits, as shown on the plans screen in the app. When an event is full, no one else can join or be let in until there is room, and the host is told.',
          'Limits may change. We will tell you in the app before a change means anything you can see is deleted.',
          'RollCal is not a backup service. Save copies of anything you want to keep. To the extent the law allows, we are not responsible for content that is lost or deleted.',
        ],
      },
      {
        heading: 'Splitting bills',
        paragraphs: [
          'RollCal helps a group keep track of who owes what. It never processes, holds or sends money. Payments happen outside the app, through banks or services such as Interac e-Transfer, Venmo, PayPal or Cash App, under their own terms.',
          'We are not part of any payment between users. We are not responsible for whether someone pays, how much, payment mistakes, or disagreements about a bill. Amounts the app works out, including from scanned receipts, can be wrong; check them before you pay or ask for money. Nothing in the app is financial or tax advice.',
          'Bills are shown in the currency they were shared in. A receipt in another currency is converted to your chosen currency at a recent exchange rate when you share it, and the bill shows the rate used. Exchange rates are a guide only: your bank, card or payment app may use a different rate or add fees.',
        ],
      },
      {
        heading: 'Receipt scanning and video recaps',
        paragraphs: [
          'When you scan a receipt, the photo is sent to an artificial-intelligence service run by Google so it can be read. Readings can be wrong or incomplete; review every line before you share a bill. See the Privacy Policy for how the photo is handled.',
          'On events with a paid plan, video recaps can show a short caption on each photo, written by an artificial-intelligence service run by Google from a small preview of the photo. The same service rates how well each photo would look in a recap, which helps pick the highlights along with people’s reactions. Captions and picks are made by a machine and can be wrong; if a caption is inappropriate, report the photo and we will remove it.',
        ],
      },
      {
        heading: 'Other services',
        paragraphs: [
          'RollCal works with services run by others, such as Sign in with Apple, Google sign-in, maps and payment apps. Their own terms and privacy policies apply when you use them, and we are not responsible for them.',
          'Apple, Google, Interac, Venmo, PayPal, Cash App, Zelle and other names of services mentioned in the app are trademarks of their owners. RollCal is not affiliated with or endorsed by them; their names are used only to say which service you use.',
          'Parts of RollCal are open-source software and open data, used under their own licences. They are listed in Settings → Open-source licences. Place names come from OpenStreetMap (© OpenStreetMap contributors) and exchange rates from ExchangeRate-API.',
        ],
      },
      {
        heading: 'Paid plans',
        paragraphs: [
          'RollCal Plus is an optional subscription, and Event Passes are optional one-time purchases that upgrade a single event. RollCal Pro is an earlier subscription that existing members keep. If you buy any of them, the Plan Terms apply as well as these terms. Guests never have to pay to join, view or add to an event.',
        ],
      },
      {
        heading: 'Ending your account',
        paragraphs: [
          'You can delete your account at any time in Settings. We may suspend or close your account if you break these terms or if we have to by law. If we stop offering RollCal, we will try to give you reasonable notice so you can save your content.',
        ],
      },
      {
        heading: 'Disclaimers',
        paragraphs: [
          'We work hard to keep RollCal running well, but to the extent the law allows, it is provided “as is” and “as available”, without warranties of any kind, including that it will always be available, error-free or secure.',
        ],
      },
      {
        heading: 'Limits on our liability',
        paragraphs: [
          'To the extent the law allows, we are not liable for indirect, incidental, special, consequential or punitive damages, or for lost data, profits or money, arising from your use of RollCal, including payments between users and content other people share.',
          'To the extent the law allows, our total liability for any claim relating to RollCal is limited to the greater of the amount you paid us for RollCal in the 12 months before the claim, or 50 Canadian dollars.',
          'Nothing in these terms limits any right you have under consumer protection law that cannot be limited by agreement.',
        ],
      },
      {
        heading: 'Responsibility for your use',
        paragraphs: [
          'To the extent the law allows, you agree to cover any claims, losses or costs that arise from your content or from you breaking these terms or the law.',
        ],
      },
      {
        heading: 'Changes to these terms',
        paragraphs: [
          'We may update these terms. If a change is significant, we will let you know in the app before it takes effect. If you keep using RollCal after that, you accept the updated terms.',
        ],
      },
      {
        heading: 'Governing law',
        paragraphs: [
          `These terms are governed by the laws of ${PROVINCE} and the federal laws of Canada that apply there, and disputes go to the courts of ${PROVINCE}, unless the consumer protection law where you live gives you the right to use its laws or courts.`,
        ],
      },
      {
        heading: 'Contact',
        paragraphs: [`Questions about these terms: ${CONTACT}.`],
      },
    ],
  },

  pro: {
    title: 'Plan Terms',
    updated: UPDATED,
    intro: 'These terms apply when you buy RollCal Plus or an Event Pass, or keep RollCal Pro, in addition to the Terms of Service.',
    sections: [
      {
        heading: 'The plans',
        paragraphs: [
          'RollCal Plus is a subscription for people who host often. Events you host can have up to 100 people, keep their photos and videos for as long as the event exists, and get full-size photos, videos up to 1 minute, video recaps with captions, and unlimited receipt scans.',
          'An Event Pass is a one-time purchase that upgrades one event you host, for everyone in it. The Party Pass allows up to 75 people, the Big Day Pass up to 300, and the Unlimited Pass has no limit on people. Each pass also keeps the event’s photos and videos for as long as the event exists, and adds full-size photos, videos up to 1 minute and video recaps with captions.',
          'RollCal Pro is an earlier subscription. If you already have it, you keep it, with what it includes today, until it ends.',
          'The plans screen in the app shows exactly what each plan includes before you buy. We may add, change or remove features over time; if we remove a major one from a plan you are paying for, we will tell you in advance.',
        ],
      },
      {
        heading: 'How Event Passes work',
        paragraphs: [
          'You choose the event when you buy a pass, and it applies only to that event. It can’t be moved to another event or another person.',
          'A pass lasts as long as the event does. If the event is deleted, including when the host deletes their account, the pass ends with it.',
          'If you have RollCal Plus, you may be offered a lower price on passes. The price you pay is always shown before you confirm.',
        ],
      },
      {
        heading: 'During the beta',
        paragraphs: [
          'While RollCal is in beta, Plus and Event Passes can’t be bought in the app yet. We may switch a plan on for free when you ask. No payment is taken, and we will tell you in the app before free beta access ends. The sections below about prices, trials and renewal apply once plans are sold through the App Store and Google Play.',
        ],
      },
      {
        heading: 'Fair use of storage',
        paragraphs: [
          'Plans include a generous amount of storage for photos and videos: 50 GB across your account with Plus, 250 GB with Pro, and 10 GB, 30 GB or 60 GB for an event with a Party, Big Day or Unlimited Pass. If a limit is reached, new uploads pause until something is removed. Nothing already uploaded is deleted because of it.',
        ],
      },
      {
        heading: 'Prices and payment',
        paragraphs: [
          'RollCal Plus costs 4.99 US dollars a month or 34.99 US dollars a year. The Party Pass costs 5.99 US dollars, the Big Day Pass 19.99 US dollars and the Unlimited Pass 29.99 US dollars, each paid once. The app may also show these prices converted into your chosen currency, as a guide only.',
          'Apple or Google charge you in the currency of your App Store or Google Play account, at the local price shown before you confirm. That price is set through the store and can differ from the converted guide. Taxes may be added where they apply.',
          'Payment is taken by Apple or Google from the account you use in their store when you confirm the purchase. We never see your card details.',
        ],
      },
      {
        heading: 'Free trial',
        paragraphs: [
          'The yearly Plus plan may come with a 7-day free trial. Unless you cancel at least 24 hours before it ends, your subscription starts and you are charged the yearly price when the trial ends. Each person can have one free trial.',
        ],
      },
      {
        heading: 'Automatic renewal',
        paragraphs: [
          'Plus and Pro renew automatically at the end of each month or year, at the price then in effect, unless you cancel at least 24 hours before the end of the current period. The renewal is charged within the 24 hours before the period ends. Event Passes are paid once and never renew.',
        ],
      },
      {
        heading: 'Cancelling',
        paragraphs: [
          'Cancel Plus or Pro any time in your App Store or Google Play subscription settings. Deleting the app or your RollCal account does not cancel a store subscription. After you cancel, your plan stays on until the end of the period you have paid for.',
        ],
      },
      {
        heading: 'Refunds',
        paragraphs: [
          'Purchases made through the App Store or Google Play, including Event Passes, are refunded by Apple or Google under their refund policies; we cannot refund them directly. This does not affect any refund right you have by law.',
        ],
      },
      {
        heading: 'Price changes',
        paragraphs: [
          'If the price of a subscription changes, you will be told in advance as the App Store or Google Play requires, and asked to agree where the law or store rules require it. You can cancel before the new price applies. A price change never affects a pass you have already bought.',
        ],
      },
      {
        heading: 'When a plan ends',
        paragraphs: [
          'When Plus or Pro ends, free plan limits apply again to events you host that don’t have a pass. No one is removed from an event, but new people can’t join one that is over the free limit. Where photos and videos would no longer be kept, or you are over the free storage limit, we will tell you in the app and give you at least 30 days to save or remove them before anything is deleted.',
        ],
      },
      {
        heading: 'Contact',
        paragraphs: [`Questions about plans or purchases: ${CONTACT}.`],
      },
    ],
  },

  privacy: {
    title: 'Privacy Policy',
    updated: UPDATED,
    intro: `This policy explains what information RollCal collects, why, and what you can do about it. ${OPERATOR} is responsible for your information.`,
    sections: [
      {
        heading: 'What we collect',
        paragraphs: [
          'Account details: your name, email address, username, profile photo, preferred currency, and, if you sign in with Apple or Google, the details they share with us.',
          'What you add: events, RSVPs, invitations, friend connections, chat messages and when you last read each event’s chat, photos and videos (including how long a video is, to check it fits your plan), reactions to photos, video recaps you make, bills and their items, and the payment handles you choose to add (such as an email or phone number for Interac e-Transfer or Zelle, a Venmo, PayPal or Cash App username, or details you write in yourself).',
          'Locations you choose: an event’s address or map pin. If you use “current location” when picking a place, your device’s location is used once for that and is not stored separately.',
          'When you contact support or report something: what you write, your account email (so we can reply), your phone type and app version, and for reports, what you reported. The person you report is not told who reported them.',
          'If you allow notifications: a notification token for your phone and your notification settings.',
          'If you buy a plan: which plan or pass you have, which event a pass is for, and when a subscription renews or ends. Apple or Google tell us this; we never see your card details.',
          'Your age: we ask when you were born when you join, to check you are 13 or older. We keep only the fact that you passed, never the date.',
          'If you join an event from a web browser instead of the app (as a guest): the name you give, the photos you add and reports you send, and a sign-in kept in that browser. We don’t ask for your email. You confirm you are 13 or older by ticking a box. A guest can only see and add photos in the events they joined.',
          'We do not use advertising or analytics tracking, and we do not sell your information.',
        ],
      },
      {
        heading: 'How we use it',
        paragraphs: [
          'Only to run RollCal: to show your events, photos and bills to the people they are shared with, to keep the app secure, to answer you when you contact us, and to meet legal obligations.',
        ],
      },
      {
        heading: 'Who can see it',
        paragraphs: [
          'People in an event can see that event’s details, members, chat (including who has seen the latest message), photos and videos and who reacted to them, its saved video recaps, and its bills, including a converted receipt’s original currency and the rate used. Payment handles you attach to a bill are visible to the people in that event. Anyone with a RollCal account can find you by your name or username and see your name and username, so friends can add you. Only you and your friends can see your profile photo, unless you choose to show it to everyone in Settings → Privacy. Your email address is never shown to other people.',
        ],
      },
      {
        heading: 'Services that handle it for us',
        paragraphs: [
          'Supabase hosts our database and sign-in. Your information is stored on servers in the United States, so it may be accessed by authorities there under US law.',
          'Photos, videos and profile photos are stored with Cloudflare (R2) and delivered through Cloudflare’s network, which sees the address your phone or browser connects from.',
          'When you scan a receipt, the photo is sent to Google’s Gemini service to read it, under Google’s terms for that service. We do not keep the photo after it has been read.',
          'On events with a paid plan, when someone makes or plays a video recap, a small preview of each photo in it is sent once to Google’s Gemini service to write a short caption describing the moment, such as “Dinner by the window”, and to rate how well it would look in the recap (used, with reactions, to pick the highlights). Only the picture is sent, not names or anything else about you. The caption is saved with the photo and shown to the people in that event; it is deleted when the photo is. Captions are written by a machine and can be wrong.',
          'Apple and Google handle sign-in when you use them, and handle payment for paid plans; we never see your card details. When paid plans go on sale, RevenueCat will check purchases with Apple and Google for us. It receives a random ID for your account and your purchase history in RollCal, not your name or email.',
          'Resend sends our emails, such as replies to support messages, from our servers. Email you send us is kept in our Microsoft 365 mailbox, and may pass through Cloudflare on the way.',
          'Our website, rollcal.app, is served by Cloudflare, which sees the address your browser connects from, as any website host does.',
          'When you drop a pin on the map, your phone sends its coordinates to OpenStreetMap’s Nominatim service to find the place’s name, under the OpenStreetMap Foundation’s privacy policy. Nothing else about you is sent.',
          'Notifications: if you allow them, we keep a token for your phone and send each notification’s text (for example a friend’s name, a preview of a chat message, or that your event is full) through Expo’s push service and Apple’s or Google’s notification service, which deliver it to your phone. You can turn notifications off in the app or in your phone’s settings.',
          'Maps are shown with Apple Maps on iPhone and Google Maps on Android. They receive the area of the map you are looking at, as any map app does, under Apple’s and Google’s privacy policies.',
          'Exchange rates come from ExchangeRate-API’s public feed. Our servers fetch the day’s rates; nothing about you is sent.',
          'When the app crashes or hits an error, Sentry receives a report of what went wrong, with the app version and your phone’s model and system version, so we can fix it. Reports don’t include your name, email, messages or photos.',
          'Most of these services are based in the United States, and some process information in other countries too, so your information may be stored and used outside Canada, under the laws of those places.',
        ],
      },
      {
        heading: 'How long we keep it',
        paragraphs: [
          'Guest sign-ins from a web browser that add no photos are deleted after 7 days; a guest’s photos are kept like everyone else’s. We keep your information while you have an account. Photos and videos in free events are deleted 30 days after the event ends, and the app warns you first. A saved video recap is deleted when its event, or any photo or video in it, is deleted or removed. When you delete your account, we delete your profile and the content linked to it, including events you created; copies may remain in backups for up to 30 days before they are overwritten. Reports other people made about you are kept without the link to your account, so we can keep RollCal safe. Copies other people have already saved stay with them.',
        ],
      },
      {
        heading: 'Your choices and rights',
        paragraphs: [
          'You can view and edit your profile, delete your content, and delete your account in the app. Depending on where you live, you may also have the right to ask for a copy of your information, to correct it, or to have it deleted; contact us to do this.',
          'You can withdraw permission for photos, camera, location or notifications at any time in your device settings.',
          `Our privacy officer handles privacy questions and requests at ${CONTACT}. We reply within 30 days. If you are not satisfied, you can complain to the Office of the Privacy Commissioner of Canada (priv.gc.ca) or the privacy regulator where you live.`,
        ],
      },
      {
        heading: 'Children',
        paragraphs: [
          'RollCal is not for children under 13, and we do not knowingly collect their information. If you believe a child under 13 has an account, contact us and we will delete it.',
        ],
      },
      {
        heading: 'Security',
        paragraphs: [
          'We use reasonable safeguards, such as encryption in transit and access rules that limit who can see each piece of information, but no system is perfectly secure.',
        ],
      },
      {
        heading: 'Changes',
        paragraphs: [
          'If we change this policy in a significant way, we will tell you in the app before the change takes effect.',
        ],
      },
      {
        heading: 'Contact',
        paragraphs: [`Privacy questions or requests: ${CONTACT}.`],
      },
    ],
  },
};
