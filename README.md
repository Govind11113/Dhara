# dhara

A new Flutter project.

## Getting Started

This project is a starting point for a Flutter application.

A few resources to get you started if this is your first Flutter project:

- [Learn Flutter](https://docs.flutter.dev/get-started/learn-flutter)
- [Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Flutter learning resources](https://docs.flutter.dev/reference/learning-resources)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.

## Planting requests (partner NGO)

Members can ask the partner NGO for a place to plant a tree. In the app this is
under **Trees → Need a place to plant?**. The NGO answers from the web dashboard
with a planting site, a date and time, and a meeting point. The member then
confirms or declines in the app.

Status flow: `open` → `scheduled` (NGO replies) → `confirmed` (member accepts) →
`completed` (NGO marks done). A `declined` request goes back to `scheduled` when
the NGO proposes a new time. A member can cancel while a request is open,
scheduled or declined.

### Creating an NGO account

NGO staff sign in to the dashboard with a normal Appwrite email and password
account that carries the `ngo` label. The label can only be set with the server
key, so nobody can give it to themselves.

1. Create the account in the Appwrite console under **Auth** (or have the person
   sign up in the Dhara app).
2. Grant the label:

   ```sh
   cd scripts
   node make_ngo.mjs staff@partner-ngo.org
   ```

   To remove access later, add `--revoke`.
3. They sign in at the dashboard and see only **Planting requests**. The `ngo`
   label does not open any admin page or any `/admin/` route. Accounts that have
   the `admin` label can also open the planting page.

### Deploying changes

```sh
cd scripts
npm run provision      # creates the planting_requests collection (safe to re-run)
npm run deploy         # api function
npm run deploy:admin   # dashboard
node e2e_planting.mjs  # live end-to-end check with throwaway accounts
```

Notes:

- There are no push notifications. The member and the NGO get a row in the
  `notifications` collection at each step. The app does not show that list yet,
  so the member finds the reply under **Trees → Planting places** (the card shows
  when a reply is waiting).
- The function's own tests: `cd functions/api && npm test`. The dashboard's:
  `cd admin && npm test`. The app's: `flutter test`.
