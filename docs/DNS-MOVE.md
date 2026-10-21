# Moving rollcal.app's DNS from GoDaddy to Cloudflare

The website (https://rollcal.pages.dev) goes on rollcal.app once the domain's
DNS is at Cloudflare. Your email (Microsoft 365 through GoDaddy) and Resend
keep working only if every record below is in Cloudflare **before** you
change the nameservers. Recorded from live DNS on 20 October 2026.

## Keep these (tick each one in Cloudflare → DNS → Records)

All of them **DNS only** (grey cloud), never proxied (orange cloud).

### Email: Microsoft 365 through GoDaddy (support@rollcal.app)
- [ ] MX `rollcal.app` → `mx1-usg2.ppe-hosted.com` priority 0
- [ ] MX `rollcal.app` → `mx2-usg2.ppe-hosted.com` priority 0
- [ ] MX `rollcal.app` → `mx3-usg2.ppe-hosted.com` priority 0
- [ ] TXT `rollcal.app` → `v=spf1 include:_spf-usg2.ppe-hosted.com include:secureserver.net ~all`
- [ ] TXT `rollcal.app` → `NETORGFT21228857.onmicrosoft.com`
- [ ] CNAME `autodiscover` → `autodiscover.outlook.com`
- [ ] CNAME `selector1._domainkey` → `selector1-rollcal-app._domainkey.netorgft21228857.w-v1.dkim.mail.microsoft`
- [ ] CNAME `selector2._domainkey` → `selector2-rollcal-app._domainkey.netorgft21228857.w-v1.dkim.mail.microsoft`
- [ ] CNAME `email` → `email.secureserver.net`
- [ ] CNAME `lyncdiscover` → `webdir.online.lync.com`
- [ ] CNAME `sip` → `sipdir.online.lync.com`
- [ ] CNAME `msoid` → `clientconfig.microsoftonline-p.net`
- [ ] SRV `_sip._tls` → priority 100, weight 1, port 443, target `sipdir.online.lync.com`
- [ ] SRV `_sipfederationtls._tcp` → priority 100, weight 1, port 5061, target `sipfed.online.lync.com`
- [ ] TXT `_dmarc` → `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;`

### Email: Resend (support and report emails sent by the app)
- [ ] TXT `resend._domainkey` → the `p=MIGfMA0GCSq…` key (copy the full value from Resend → Domains → rollcal.app)
- [ ] CNAME `send` → `send.forge.rmta.net` (Resend's GoDaddy setup used one CNAME here, which carries the bounce MX and SPF; don't add them separately)
- [ ] CNAME `rsend` → `rsend.forge.rmta.net` (the return address Resend actually sends with. Missed in the first move on 20 October 2026: Gmail still accepted the mail, but Microsoft 365/Proofpoint rejected it with "550 5.1.8 Sender address rejected: Domain not found" and Outlook.com filed it as junk. Resend's dashboard kept showing it as Verified from the GoDaddy days, so check it with a DNS lookup, not the dashboard.)

## Don't copy these

- A `rollcal.app` → `3.33.130.190` and `15.197.148.33` (GoDaddy's parked page; the website replaces it)
- CNAME `www` → `rollcal.app` (the website setup replaces it)
- CNAME `_domainconnect` (GoDaddy-only)
