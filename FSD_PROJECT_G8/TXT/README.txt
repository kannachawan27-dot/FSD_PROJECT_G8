G8 BAKERY — FULL-STACK PROJECT

FEATURES
- Customer cake customization, live preview and price estimate.
- Server-side booking validation and daily limit of 25 cakes per pickup date.
- SQLite database stores bookings centrally (not browser localStorage).
- Admin login with scrypt password hashing and HttpOnly session cookie.
- Protected admin dashboard, order status updates, CSV export and printable receipts.
- Server-side input normalization, length limits, allow-list validation and safe DOM rendering.
- Automated Node.js tests for input validation and password hashing.

REQUIREMENTS
- Node.js 22.5 or newer (Node 26 is supported).

FIRST-TIME SETUP (VS CODE TERMINAL)
1. Open the extracted G8 project folder in VS Code.
2. Open Terminal > New Terminal.
3. Run: npm run create-admin
4. Enter an admin username and a strong password (at least 12 characters).
5. Run: npm test
6. Run: npm start
7. Open: http://localhost:3000

ADMIN LOGIN
Use the username and password created in step 3. No default username or password is stored in the source code. If you forget the password, create a new admin account with a different username; a production deployment should add a controlled password-reset workflow.

PROJECT STRUCTURE
- HTML/       Customer, admin dashboard and admin login pages
- CSS/        Shared responsive stylesheet
- JS/         Customer and admin browser logic
- server.js   HTTP server and JSON API
- data/       SQLite database (created automatically)
- scripts/    Admin account setup utility
- tests/      Automated tests

IMPORTANT SECURITY / DEPLOYMENT NOTES
- The admin session is held in server memory and expires after 8 hours. Restarting the server logs out current admins.
- Use HTTPS and a production reverse proxy before exposing this application to the public internet. Set secure cookie handling for HTTPS deployment.
- Back up data/g8-bakery.sqlite regularly. Do not upload the database or passwords to a public repository.
- Ingredient quantities are estimates (300 g flour, 250 g sugar, 200 g butter and 250 g cream per kg); verify these against your bakery's actual recipes before purchasing ingredients.
- Cake inspiration images are preview-only in the browser and are not uploaded to the server.

IMPORTANT: Start the site using `npm start` and open http://localhost:3000. Do NOT open HTML/index.html directly and do NOT use the VS Code Live Server extension, because booking requests must reach the Node.js API server.
