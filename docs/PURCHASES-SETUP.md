# Setting up purchases (RevenueCat): your steps

You do this part yourself (accounts, payments and keys). I wire it into the app once you send me
the two **public** SDK keys. **Never** paste a secret key (starting `sk_`) or a `.p8` / JSON key
file into chat. Those go only into RevenueCat's dashboard or Supabase secrets.

Products to create (prices in USD; the stores set local prices):

| Product ID | Type | Price |
|---|---|---|
| `rollcal_plus_monthly` | Auto-renewing subscription | $4.99 / month |
| `rollcal_plus_yearly` | Auto-renewing subscription, 7-day free trial | $34.99 / year |
| `rollcal_pass_party` | Consumable | $5.99 |
| `rollcal_pass_bigday` | Consumable | $19.99 |
| `rollcal_pass_unlimited` | Consumable | $29.99 |

Passes are consumable because each one is for a different event; the server records which event.

## 1. RevenueCat account and project
1. Go to **app.revenuecat.com** and sign up with your work email.
2. Click **Create new project**, and name it **RollCal**.

## 2. Apple (App Store Connect)
1. In **App Store Connect** → **Agreements, Tax, and Banking**, make sure the **Paid Apps** agreement is active.
2. Go to **Apps** → **RollCal** → **Monetization** → **Subscriptions**:
   - Create a group called **RollCal Plus**.
   - Add `rollcal_plus_monthly` and `rollcal_plus_yearly` with the prices above.
   - On the yearly plan, add an **Introductory Offer**: Free, 1 week.
3. In **In-App Purchases**, click **+**, choose **Consumable**, and add the three pass IDs with their prices.
4. In **Users and Access** → **Integrations** → **App Store Connect API**:
   - Create a key with the **App Manager** role.
   - Download the `.p8` file. It can only be downloaded once, so keep it safe.
   - Note the **Issuer ID**.
5. In **Users and Access** → **Integrations** → **In-App Purchase**, create a key and download it (`SubscriptionKey_….p8`).
6. In RevenueCat, go to the project → **Apps** → **+ New** → **App Store** and enter:
   - **Bundle ID:** `app.rollcal`
   - **App Store Connect API** tab: upload the `AuthKey_….p8`, then enter the Issuer ID and your **Vendor number** (from **Payments and Financial Reports**).
   - **In-App Purchase Key:** upload the `SubscriptionKey_….p8`.

## 3. Google Play
1. In **Google Play Console** → **RollCal** → **Monetize** → **Subscriptions**, create **RollCal Plus** with two base plans, monthly and yearly. Give the yearly plan a 7-day free trial offer.
2. In **Monetize** → **In-app products**, add the three pass IDs.
3. In **Google Cloud Console**:
   - Turn on the **Google Play Android Developer API** and the **Play Developer Reporting API**.
   - Create a **service account** with the roles **Pub/Sub Editor** and **Monitoring Viewer**.
   - Open it and go to **Keys** → **Add key** → **JSON**, and download the file.
4. In **Play Console** → **Users and permissions**:
   - Invite the service account's email address.
   - Give it access to RollCal with: view app information, view financial data, manage orders and subscriptions, and manage store presence.
5. In RevenueCat, go to **Apps** → **+ New** → **Play Store**:
   - Enter the package name `app.rollcal`.
   - Upload the JSON file. It can take up to 36 hours to validate.

## 4. Products, entitlement and offering in RevenueCat
1. Go to **Product catalog** → **Products**, and import all 5 products from both stores.
2. Go to **Entitlements** → **+ New entitlement**:
   - Name it **plus**.
   - Attach the two Plus subscriptions only. Passes are **not** attached to it.
3. Go to **Offerings** → **+ New**, call it **default**, and add all 5 products.

## 5. Send me the public keys
Go to **Project settings** → **API keys**. Copy the **public** Apple key and the **public** Google key,
and send them to me. These are safe to put in the app.

## 6. Later, when I build the webhook
- In RevenueCat, go to **Integrations** → **Webhooks** → **Add new configuration**.
- I'll give you the URL and how to set the authorization value **as a Supabase secret** (it isn't
  pasted anywhere else).
- Webhooks need RevenueCat's paid plan; it's free until you earn a set amount each month, so check
  their current pricing page.

## Testing
- Purchases don't work in Expo Go or on the simulator's mock store. They need a development
  build and Apple or Google **sandbox test accounts**.
- We'll do this once you're ready to move off the simulator, as agreed.
