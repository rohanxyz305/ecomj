# Glamora Jewels: Artificial Jewellery Store

A responsive jewellery storefront with customer accounts, a bag with checkout (Cash on Delivery), and a separate admin panel.

## Run it

```bash
npm install
npm start
```

- Store: http://localhost:3000
- Admin: http://localhost:3000/admin

**Default admin login:** `admin` / `admin@123`. Change it in **Admin → Settings** right after your first login.
You can also set your own before the first run: `ADMIN_USER=you ADMIN_PASSWORD=secret npm start`.

## Features

**Store (customers)**
- Sign In / Sign Up buttons in the header. Accounts persist, and passwords are hashed with scrypt.
- Category browsing, search, sorting and an "in stock only" filter
- Offer ticker, offer cards and automatic discounted prices
- Wishlist, bag drawer with a free-shipping progress bar, quick view
- Checkout with address and Cash on Delivery, plus a "My Orders" history
- Fully responsive: desktop, tablet and phone

**Admin panel (`/admin`)**
- Dashboard: product, offer, order and revenue stats, plus low-stock alerts
- Products: add, edit and delete. Upload a photo or paste an image URL. Set price, MRP, stock, badge and description
- Availability: flip the switch or edit the stock number right in the table. Sold-out and hidden items can't be bought
- Offers: percentage discount on all products or one category, with an end date, a colour theme and a pause/activate switch
- Orders: view items and address, and update status. Cancelling returns the items to stock
- Settings: change the admin password (this logs out other admin sessions)

## Where things live

```
server.js          API routes (store, customer auth, admin)
lib/seed.js        Categories, badges, shipping rules, offer colours, sample data  ← edit to customise
lib/db.js          JSON-file storage
lib/auth.js        Password hashing + signed session cookies
data/              Your store data (products, offers, users, orders). Back this folder up.
public/uploads/    Product photos uploaded from the admin
public/index.html  Storefront page          public/css/style.css  Store design (colours in :root)
public/admin.html  Admin page               public/css/admin.css  Admin design
public/js/app.js   Storefront logic         public/js/admin.js    Admin logic
public/js/art.js   Illustrations shown for products without a photo
```

**Photos:** sample product and category photos are in `public/images/` and come from Wikimedia Commons under free licences. They're credited at `/credits` (data in `public/images/credits.json`). Most of these licences require that credit, so keep the footer "Photo credits" link while you use them. Once you replace them with your own product photos (Admin → Products → Edit → Upload photo), you can remove the credits. Category tile photos are set in `CATEGORY_IMAGES` in `lib/seed.js`.

**Reset to sample data:** stop the server, delete the `data/` folder, and start it again.

## Going live

- Host on any Node.js host (Render, Railway, a VPS, etc.) that has a **persistent disk** for `data/` and `public/uploads/`.
- Set `NODE_ENV=production` (secure cookies over HTTPS), and set `APP_SECRET` to a long random string.
- Update the contact details in the footer of `public/index.html`.
- Payments are Cash on Delivery only. Online payment (e.g. Razorpay) can be added to the checkout later.

## Automatic deploys (GitHub Actions)

`.github/workflows/deploy.yml` checks the code on every push. When `DEPLOY_METHOD` is set, each push to `main` is also uploaded to your shared hosting and the app is restarted.
It never uploads over or deletes `data/` or `public/uploads/` on the server.

Set these in GitHub → repo **Settings → Secrets and variables → Actions**:

| Name | Kind | FTP | SSH | Example |
|---|---|---|---|---|
| `DEPLOY_METHOD` | Variable | `ftp` | `ssh` | `ftp` |
| `APP_DIR` | Variable | ✔ | ✔ | `glamora-jewels` (the Node.js app root, relative to your home folder) |
| `SITE_URL` | Variable | optional | optional | `https://yourdomain.com` (checked after each deploy) |
| `FTP_SERVER` | Secret | ✔ | | `ftp.yourdomain.com` |
| `FTP_USERNAME` | Secret | ✔ | | your cPanel FTP user |
| `FTP_PASSWORD` | Secret | ✔ | | |
| `FTP_PROTOCOL` / `FTP_PORT` | Variable | optional | | default `ftps` / `21` |
| `SSH_HOST` | Secret | | ✔ | `yourdomain.com` or the server IP |
| `SSH_USER` | Secret | | ✔ | your cPanel username |
| `SSH_PRIVATE_KEY` | Secret | | ✔ | private key whose public key is authorised in cPanel → SSH Access |
| `SSH_PORT` | Variable | | optional | default `22` |
| `NODE_VENV_ACTIVATE` | Variable | | optional | `/home/USER/nodevenv/glamora-jewels/20/bin/activate` (shown at the top of the app in cPanel → Setup Node.js App) |

With FTP, packages aren't installed on the server: click **Run NPM Install** in cPanel → Setup Node.js App after the first deploy and whenever `package.json` changes.
