# Newsletter — double opt-in signup flow (implementation instructions)

**For:** Kamindu — **Date:** 19 Jul 2026 — **Follows:** `newsletter-dev-spec.md` + review findings B1/H1/H2/H3 in `newsletter-review-2026-07-14.md`.

## Scope — read this first

**✅ In scope (build now, on staging):**
1. The newsletter signup form on the site, using Caroline's approved content (verbatim texts below).
2. The Brevo double opt-in wiring: new signups → confirmation email → on click, contact added automatically to the Brevo list.
3. The confirmation landing page (+ preferences form that fills the segmentation attributes).
4. Turnstile on the signup path.
5. **Sending-domain prep**: create and authenticate `actu.immobiliere-pujol.fr` (Step 7).

**⛔ Out of scope — Roy supervises these personally. Do NOT touch:**
- Importing the existing master list (the 2 495 cleaned contacts) into Brevo.
- Any email to any existing contact (no reconfirmation campaign, no test blasts to lists).
- Production deploys, as always, only with Roy's explicit approval.

Everything below is built and tested against the **staging Brevo account** (the one already provisioned on the staging workers). Roy replicates the Brevo-side objects on prod when he does the supervised part.

---

## Step 0 — Brevo objects (staging account)

1. **DOI email template**: Brevo → Campaigns → Templates → create `DOI — Confirmation inscription site`. Body = Caroline's text (§ "Contenu" below, *Mail de confirmation 2*). It **must contain the `{{ doubleoptin }}` placeholder** as the href of the « CONFIRMER MON INSCRIPTION » button. Note the numeric template id.
   **Footer rule (applies to every email template, Brevo or code):** never show `contact@immobiliere-pujol.fr` — the footer contact line is `Contact → Nous contacter` linking to `https://www.immobiliere-pujol.fr/contact-immobiliere-pujol/` (inquiries must go through the site form so they're routed and filterable by subject). The `rgpd@` address in the legal notice stays. The code templates were updated on 19 Jul — mirror this in anything you build in Brevo.
2. **Contact attributes** (Contacts → Settings → Attributes) — create exactly these (prod will mirror them):

| Name | Type |
|---|---|
| `PRENOM`, `NOM` | text |
| `SOURCE` | text |
| `CONSENT_METHOD` | text |
| `CONSENT_DATE` | date |
| `INTERET_LOCATION`, `INTERET_VENTE`, `INTERET_SYNDIC`, `INTERET_TOUS` | boolean |
| `PROPRIETAIRE` | category: `proprietaire` / `locataire` / `en_recherche` |

3. Confirm the existing `NEWSLETTER_LIST_ID` points at the staging test list (never a real list).

## Step 1 — New secrets/vars

Email worker (`workers/email/`):
```
wrangler secret put DOI_TEMPLATE_ID                  # from Step 0.1
wrangler secret put NEWSLETTER_CONFIRM_SECRET        # openssl rand -hex 32 — for the HMAC below
# var (or secret): NEWSLETTER_CONFIRM_REDIRECT_URL = https://immobiliere-pujol-staging.roy-68a.workers.dev/newsletter-confirmee
```
Main app: `wrangler secret put NEWSLETTER_CONFIRM_SECRET` (same value — the landing page verifies the HMAC).

## Step 2 — Rework `handleNewsletter` (review B1)

`workers/email/index.ts:791` — replace the current notify-only stub. New behaviour:

```ts
async function handleNewsletter(fd: FormData, env: Env, ctx: ExecutionContext) {
  const email = ((fd.get('email') as string) || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return { ok: false, error: 'Email invalide.' };

  // per-contact redirect: the landing page must know WHO confirmed, verifiably
  const t = await hmacHex(env.NEWSLETTER_CONFIRM_SECRET!, email);   // Web Crypto HMAC-SHA256, hex
  const redirect = `${env.NEWSLETTER_CONFIRM_REDIRECT_URL}?e=${encodeURIComponent(email)}&t=${t}`;

  const res = await fetch('https://api.brevo.com/v3/contacts/doubleOptinConfirmation', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY!, 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      includeListIds: [Number(env.NEWSLETTER_LIST_ID)],
      templateId: Number(env.DOI_TEMPLATE_ID),
      redirectionUrl: redirect,
      attributes: { SOURCE: 'nouveau_site', CONSENT_METHOD: 'site_doi' },
    }),
  });
  // Brevo: 201/204 = OK. 400 "already exists / already in list" = treat as OK for the visitor.
  if (!res.ok && res.status !== 400) return { ok: false, error: "Inscription impossible pour le moment." };

  ctx.waitUntil(logToSheet('Newsletter', [now(), email]));   // keep the Sheet trail
  return { ok: true };
}
```

Notes:
- Brevo sends the confirmation email, hosts the signed confirm link, **records the click as the consent proof**, adds the contact to the list *only after* the click, then redirects to our URL. We store nothing ourselves.
- Keep the honeypot `_hp` check (already global). **Remove the internal notification to contact@/Caroline** — signups now live in Brevo; Caroline will see them there (keep the Sheet log line).

## Step 3 — Turnstile (review H1)

- `workers/email/index.ts:965`: change `path !== '/newsletter'` so `/newsletter` is **enforced** like the other forms.
- `NewsletterSignup.astro`: add the widget (site key `0x4AAAAAADow4gNbXgTPXvdL`, `data-appearance="interaction-only"`) and submit its token. Staging has no `TURNSTILE_SECRET` so it stays permissive there; test the strict path by temporarily setting a test secret if needed.

## Step 4 — Signup form content (Caroline's texts, verbatim)

Update `src/components/common/NewsletterSignup.astro`:

**Encart:**
> **Inscrivez-vous à notre newsletter**
> *Recevez tous les mois nos derniers articles sur le marché immobilier à Marseille ainsi que les conseils de nos experts.*
>
> [Email]
>
> ☐ J'accepte le traitement de mes données dans le cadre de mon inscription à la newsletter

Keep the existing full RGPD paragraph (already in the component) under/near the checkbox. The checkbox must be **required**.

**Success message after submit (review H3)** — replace « Merci pour votre inscription ! » with (highlighted style, per Caroline's request):
> **Votre inscription n'est pas encore finalisée à ce stade.** Veuillez cliquer sur le lien de validation envoyé sur votre boîte email.

⚠️ Caroline's texts are client content: **word for word, no rewording**. If you spot a typo/spacing issue, flag it to Roy — do not fix it yourself.

## Step 5 — Landing page `/newsletter-confirmee` (review H2 + preferences)

New `src/pages/newsletter-confirmee.astro` (public, prerender off):

1. Read `e` + `t` from the query string; recompute HMAC with `NEWSLETTER_CONFIRM_SECRET`; valid → personalized state, invalid/absent → generic thanks (no form).
2. Show: **« Merci, votre inscription est confirmée. »**
3. Below it, the **preferences form** (optional — the subscription is already complete at this point, say so):
   - Nom, Prénom
   - « Quels sont les sujets qui vous intéressent le plus ? *(cochez autant de cases que vous souhaitez)* » with Caroline's 4 checkboxes, verbatim:
     - Le marché de la location à Marseille, les prix des loyers, nos articles/conseils pour bien louer et gérer
     - Le marché des ventes à Marseille, les prix au m², nos articles/conseils pour bien vendre ou acheter
     - Le syndic et la gestion des copropriétés
     - Pas de sujets en particulier ; tous vos articles m'intéressent
   - *(One more question — « êtes-vous propriétaire ? » — is pending Caroline's validation; leave a commented block ready for it.)*
4. Submit → `POST /api/newsletter/preferences` (new route, public but HMAC-guarded): body `{e, t, prenom, nom, interets[]}`. Verify HMAC server-side, then call the email worker (new internal endpoint `POST /newsletter/attributes`, guarded by `x-internal-token`) which does Brevo `PUT /v3/contacts/{email}` setting `PRENOM`, `NOM`, `INTERET_*` booleans (checkbox 4 → `INTERET_TOUS=true`).
5. Mapping rule: no boxes ticked = don't write any `INTERET_*` (absence = "tous" by convention at campaign time).

## Step 6 — Test checklist (staging, end to end)

- [ ] Signup with a real inbox you control → Brevo DOI email arrives (Caroline's text, button works)
- [ ] Before click: contact NOT in the staging list; after click: contact present, consent recorded by Brevo
- [ ] Redirect lands on `/newsletter-confirmee?e=…&t=…`, shows merci + form
- [ ] Preferences submit → attributes visible on the Brevo contact
- [ ] Tampered `t` → generic page, preferences API 403
- [ ] Duplicate signup (same email twice) → visitor still sees success, no error leak
- [ ] Honeypot filled → silent accept, nothing sent
- [ ] `dataLayer` `form_submit` still pushed
- [ ] Sheet `Newsletter` still logs the attempt

## Step 7 — Sending-domain prep: `actu.immobiliere-pujol.fr`

Goal: authenticate the dedicated newsletter sending subdomain so campaign emails pass SPF/DKIM/DMARC, isolated from the agency's `contact@` reputation. You have what's needed: the Cloudflare zone `immobiliere-pujol.fr` lives in the Pujol Cloudflare account.

1. **In Brevo** (⚠️ in the Brevo account that will actually send the newsletters in production — coordinate with Roy on which account that is before starting; a domain should be authenticated in ONE Brevo account only, or the DKIM selectors conflict):
   Senders & Domains → Domains → **Add a domain** → `actu.immobiliere-pujol.fr`. Brevo displays 3-4 DNS records: its verification TXT (`brevo-code`), the **DKIM** record(s), and a **DMARC** TXT. Copy them **exactly as shown** — don't retype from this doc.
2. **In Cloudflare** (Pujol account, zone `immobiliere-pujol.fr`): add those records verbatim. TXT records are DNS-only by nature. For DMARC, if Brevo proposes a policy, start at **`p=none`** (monitor mode) — we tighten later once sends are stable.
3. Back in Brevo: click **Authenticate/Verify** and wait for all checks to go **green** (usually minutes on Cloudflare).
4. **Create the sender**: `Immobilière Pujol <newsletter@actu.immobiliere-pujol.fr>` in the same Brevo account.
5. **Do NOT** repoint `NEWSLETTER_SENDER_EMAIL` on any deployed worker yet — Roy flips the sender at go-live. Just report to Roy: which Brevo account, the records added, verification status, sender created.
6. Note for later (not yours): `newsletter@actu.…` has no mailbox. Replies should carry `Reply-To: contact@immobiliere-pujol.fr` (template/campaign setting) or we add a Cloudflare Email Routing rule — Roy decides at go-live.

---

When all green on staging (Steps 0-6) and the domain is authenticated (Step 7), ping Roy — he reviews, then handles prod (Brevo prod objects, secrets, sender switch, deploy) plus the supervised list import/reconfirmation.
