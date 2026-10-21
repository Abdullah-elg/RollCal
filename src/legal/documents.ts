// The Terms of Service, Pro Terms and Privacy Policy, shown in the app (sign
// up, Settings, the upgrade screen). Plain language on purpose.
//
// Before launch: have a lawyer review all three documents, and publish the
// same text at public web addresses (npm run build:legal writes them to
// web/; the App Store and Google Play both ask for a privacy policy URL).

const OPERATOR = 'RollCal';
const CONTACT = 'support@rollcal.app';
const PROVINCE = 'Ontario';
const UPDATED = 'October 20, 2026';

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
    intro: `These terms are an agreement between you and ${OPERATOR} ("we", "us"), who runs RollCal. By creating an account or using the app, you agree to them. If you don't agree, please don't use RollCal.`,
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
          'You own the photos, videos, messages and other things you add ("your content").',
          'So that the app can work, you give us a worldwide, non-exclusive, royalty-free licence to host, store, copy, process and display your content, only to run and improve RollCal. This licence ends when your content is deleted, except for copies we must keep by law or that remain for a short time in backups.',
          'When you add photos or videos to an event, everyone in that event can view, download and save them. Copies people have already saved stay with them even if you later delete yours.',
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
        heading: 'Photo storage',
        paragraphs: [
          'Storage limits and how long event photos and videos are kept depend on your plan and are shown in the app. These may change; we will tell you in the app before anything you can see is deleted because of them.',
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
        heading: 'Receipt scanning',
        paragraphs: [
          'When you scan a receipt, the photo is sent to an artificial-intelligence service run by Google so it can be read. Readings can be wrong or incomplete; review every line before you share a bill. See the Privacy Policy for how the photo is handled.',
        ],
      },
      {
        heading: 'Other services',
        paragraphs: [
          'RollCal works with services run by others, such as Sign in with Apple, Google sign-in, maps and payment apps. Their own terms and privacy policies apply when you use them, and we are not responsible for them.',
          'Apple, Google, Interac, Venmo, PayPal, Cash App and other names of services mentioned in the app are trademarks of their owners. RollCal is not affiliated with or endorsed by them; their names are used only to say which service you use.',
          'Parts of RollCal are open-source software and open data, used under their own licences. They are listed in Settings → Open-source licences. Place names come from OpenStreetMap (© OpenStreetMap contributors) and exchange rates from ExchangeRate-API.',
        ],
      },
      {
        heading: 'RollCal Pro',
        paragraphs: [
          'Pro is an optional paid subscription. If you subscribe, the Pro Terms apply as well as these terms.',
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
          'We work hard to keep RollCal running well, but to the extent the law allows, it is provided "as is" and "as available", without warranties of any kind, including that it will always be available, error-free or secure.',
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
    title: 'RollCal Pro Terms',
    updated: UPDATED,
    intro: 'These terms apply when you subscribe to RollCal Pro, in addition to the Terms of Service.',
    sections: [
      {
        heading: 'What Pro includes',
        paragraphs: [
          'Pro adds the features listed on the Pro screen in the app. We may add, change or remove Pro features over time; if we remove a major one, we will tell you in advance.',
        ],
      },
      {
        heading: 'Fair use of storage',
        paragraphs: [
          'Pro includes up to 200 GB of stored photos and videos across all your events (free accounts include 2 GB). If you reach it, new uploads pause until you remove something; nothing you have already uploaded is deleted because of it.',
        ],
      },
      {
        heading: 'Price and payment',
        paragraphs: [
          'Pro is priced at 6.99 US dollars a month or 49.99 US dollars a year. The app also shows these prices converted into your chosen currency at a recent exchange rate, as a guide only.',
          'Apple or Google charge you in the currency of your App Store or Google Play account, at the local price shown before you confirm. That price is set through the store and can differ from the converted guide. Taxes may be added where they apply.',
          'Payment is taken by Apple or Google from the account you use in their store when you confirm the purchase.',
        ],
      },
      {
        heading: 'Free trial',
        paragraphs: [
          'If a free trial is offered, it lasts 7 days. Unless you cancel at least 24 hours before it ends, your subscription starts and you are charged when the trial ends. Each person can have one free trial.',
        ],
      },
      {
        heading: 'Automatic renewal',
        paragraphs: [
          'Your subscription renews automatically at the end of each month or year, at the price then in effect, unless you cancel at least 24 hours before the end of the current period. The renewal is charged within the 24 hours before the period ends.',
        ],
      },
      {
        heading: 'Cancelling',
        paragraphs: [
          'Cancel any time in your App Store or Google Play subscription settings. Deleting the app or your RollCal account does not cancel a store subscription. After you cancel, Pro stays on until the end of the period you have paid for.',
        ],
      },
      {
        heading: 'Refunds',
        paragraphs: [
          'Purchases made through the App Store or Google Play are refunded by Apple or Google under their refund policies; we cannot refund them directly. This does not affect any refund right you have by law.',
        ],
      },
      {
        heading: 'Price changes',
        paragraphs: [
          'If the price changes, you will be told in advance as the App Store or Google Play requires, and asked to agree where the law or store rules require it. You can cancel before the new price applies.',
        ],
      },
      {
        heading: 'When Pro ends',
        paragraphs: [
          'When your subscription ends, free plan limits apply again. Where you are over a free limit, such as storage, we will tell you in the app and give you at least 30 days to save or remove content before anything is deleted.',
        ],
      },
      {
        heading: 'Contact',
        paragraphs: [`Questions about Pro: ${CONTACT}.`],
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
          'What you add: events, RSVPs, invitations, friend connections, chat messages, photos and videos, bills and their items, and the payment handles you choose to add (such as an email or phone number for Interac e-Transfer, or a Venmo, PayPal or Cash App username).',
          'Locations you choose: an event’s address or map pin. If you use “current location” when picking a place, your device’s location is used once for that and is not stored separately.',
          'When you contact support or report something: what you write, your account email (so we can reply), your phone type and app version, and for reports, what you reported. The person you report is not told who reported them.',
          'If you allow notifications: a notification token for your phone and your notification settings.',
          'Your age: we ask when you were born when you join, to check you are 13 or older. We keep only the fact that you passed, never the date.',
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
          'People in an event can see that event’s details, members, chat, photos and bills, including a converted receipt’s original currency and the rate used. Payment handles you attach to a bill are visible to the people in that event. Friends and people you share events with can see your name, username and profile photo.',
        ],
      },
      {
        heading: 'Services that handle it for us',
        paragraphs: [
          'Supabase hosts our database, file storage and sign-in. Your information is stored on servers in the United States, so it may be accessed by authorities there under US law.',
          'When you scan a receipt, the photo is sent to Google’s Gemini service to read it, under Google’s terms for that service. We do not keep the photo after it has been read.',
          'Apple and Google handle sign-in when you use them, and will handle payment for Pro; we never see your card details.',
          'Resend sends our emails, such as replies to support messages, from our servers.',
          'When you drop a pin on the map, your phone sends its coordinates to OpenStreetMap’s Nominatim service to find the place’s name, under the OpenStreetMap Foundation’s privacy policy. Nothing else about you is sent.',
          'Notifications: if you allow them, we keep a token for your phone and send each notification’s text (for example a friend’s name or a preview of a chat message) through Expo’s push service and Apple’s or Google’s notification service, which deliver it to your phone. You can turn notifications off in the app or in your phone’s settings.',
          'Exchange rates come from ExchangeRate-API’s public feed. Our servers fetch the day’s rates; nothing about you is sent.',
        ],
      },
      {
        heading: 'How long we keep it',
        paragraphs: [
          'We keep your information while you have an account. Event photos and videos may be deleted sooner under the storage rules shown in the app. When you delete your account, we delete your profile and the content linked to it, including events you created; copies may remain in backups for a short time before they are overwritten. Copies other people have already saved stay with them.',
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
