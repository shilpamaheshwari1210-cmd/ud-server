# CLAUDE.md — Unique Dressup

> **Authoritative engineering reference for the Unique Dressup full-stack e-commerce platform.**
> This single document covers **BOTH** the backend and the frontend.
> Read this file **before** making any change to either codebase.
>
> Last full analysis: **2026-07-27** (backend `7b7531f`, frontend `69b123f`)

---

## Table of Contents

| # | Section | # | Section |
|---|---------|---|---------|
| 1 | [Project Overview](#1-project-overview) | 24 | [CI/CD](#24-cicd) |
| 2 | [Folder Structure](#2-folder-structure) | 25 | [Known Issues](#25-known-issues) |
| 3 | [Technologies](#3-technologies) | 26 | [Future Improvements](#26-future-improvements) |
| 4 | [Frameworks](#4-frameworks) | 27 | [Coding Rules](#27-coding-rules) |
| 5 | [Libraries](#5-libraries) | 28 | [Do's and Don'ts](#28-dos-and-donts) |
| 6 | [Build Commands](#6-build-commands) | 29 | [Development Workflow](#29-development-workflow) |
| 7 | [Run Commands](#7-run-commands) | 30 | [Architecture Diagram](#30-architecture-diagram) |
| 8 | [Environment Variables](#8-environment-variables) | 31 | [Data Flow](#31-data-flow) |
| 9 | [Coding Standards](#9-coding-standards) | 32 | [API Flow](#32-api-flow) |
| 10 | [Naming Conventions](#10-naming-conventions) | 33 | [Dependency Graph](#33-dependency-graph) |
| 11 | [API Standards](#11-api-standards) | 34 | [Business Modules](#34-business-modules) |
| 12 | [Folder Guidelines](#12-folder-guidelines) | 35 | [Glossary](#35-glossary) |
| 13 | [Database Overview](#13-database-overview) | | |
| 14 | [Authentication Flow](#14-authentication-flow) | | |
| 15 | [Authorization Flow](#15-authorization-flow) | | |
| 16 | [Frontend Architecture](#16-frontend-architecture) | | |
| 17 | [Backend Architecture](#17-backend-architecture) | | |
| 18 | [API Documentation](#18-api-documentation) | | |
| 19 | [Common Components & Reusable Modules](#19-common-components--reusable-modules) | | |
| 20 | [Error Handling & Logging](#20-error-handling--logging) | | |
| 21 | [Security Practices](#21-security-practices) | | |
| 22 | [Deployment & Server Configuration](#22-deployment--server-configuration) | | |
| 23 | [Testing Strategy & QA Checklist](#23-testing-strategy--qa-checklist) | | |

---

## 1. Project Overview

**Unique Dressup** is a D2C fashion e-commerce platform for the Indian market (INR, GST-inclusive pricing, pincode-based addresses). It consists of two independently deployed applications sharing one MySQL database through a REST API.

| Property | Backend | Frontend |
|---|---|---|
| Package name | `fashion-ecommerce-backend` | `fashion-ecommerce-frontend` |
| Repo | `git@github-jatin:jitendra-dhandiya1276/ud-server.git` | `git@github-jatin:jitendra-dhandiya1276/ud-client.git` |
| Local path | `/home/jitendra/work/dev/office/unique-dressup/backend` | `/home/jitendra/work/dev/office/unique-dressup/frontend` |
| Runtime | Node.js 20 | Node.js 20 |
| Default port | `5000` | `3000` |
| Entry point | `src/server.ts` → `src/app.ts` | `app/layout.tsx` (Next App Router) |
| API base | `/api/v1` | consumes `${API_URL}` |

### What the platform does

- **Storefront** — homepage builder (admin-configurable sections), product catalog with variants (size / colour / material), category & collection browsing, gender toggle (MEN / WOMEN / UNISEX), search, wishlist, guest + authenticated cart, coupons, checkout, order tracking, blogs, CMS pages, store locator, Instagram reels.
- **Admin panel** — served from the *same* Next.js app under `/admin`: dashboard analytics, product & variant CRUD, categories, collections, orders, customers, banners, homepage builder, coupons, reviews moderation, media library, SEO, settings.
- **Payments** — Cash on Delivery, Razorpay (fully wired end-to-end), Cashfree (backend complete, frontend **not yet wired** — see §25).

### Single-app admin, not a separate deployment

There is no separate admin project. The admin lives in the Next.js route group `app/(admin)/`. `ADMIN_URL` in the backend env exists only for CORS allow-listing.

---

## 2. Folder Structure

### 2.1 Backend

```
backend/
├── CLAUDE.md                     ← this file
├── Dockerfile                    multi-stage: node:20-alpine builder → runner
├── ecosystem.config.js           PM2 cluster config (app name: luxestore-api)
├── package.json
├── tsconfig.json                 strict, CommonJS, outDir ./dist, paths @/* → src/*
├── .env / .env.example
├── docs/                         EMPTY
├── logs/                         winston output (error.log, combined.log) — gitignored
├── uploads/                      multer disk storage, served at /uploads — gitignored
├── prisma/
│   ├── schema.prisma             965 lines · 34 models · 13 enums · MySQL
│   └── migrations/               EMPTY — schema is deployed via `db push` (see §13)
└── src/
    ├── server.ts                 bootstrap · DB init/seed · graceful shutdown
    ├── app.ts                    express app · middleware chain · route mounting
    ├── config/
    │   ├── env.ts                typed config object from process.env
    │   └── prisma.ts             PrismaClient singleton (global cache in dev)
    ├── middlewares/
    │   ├── auth.middleware.ts    authenticate · authorize · isAdmin · isSuperAdmin
    │   ├── error.middleware.ts   AppError class · notFound · errorHandler
    │   └── validate.middleware.ts Joi validation factory
    ├── modules/                  ← 20 feature modules, see §12
    │   └── <module>/
    │       ├── controllers/      <name>.controller.ts   (required)
    │       ├── routes/           <name>.routes.ts       (required)
    │       ├── services/         <name>.service.ts      (only where logic is heavy)
    │       └── validators/       <name>.validators.ts   (auth only, today)
    ├── utils/
    │   ├── jwt.ts                sign/verify access & refresh tokens
    │   ├── logger.ts             winston (console + rotating files)
    │   ├── response.ts           sendSuccess · sendError · sendPaginated
    │   ├── slugify.ts            createSlug · generateOrderNumber · paginationParams
    │   └── upload.ts             createUploader · optimizeImage · getImageUrl · deleteFile
    ├── types/xss-clean.d.ts      ambient module declaration
    ├── validators/               EMPTY (validators live per-module)
    ├── jobs/                     EMPTY (no scheduled jobs yet)
    └── scripts/
        └── seedGenderDemo.ts     idempotent demo seeder (10 products, 5 banners)
```

**Module inventory (20):** `admin` (analytics), `auth`, `banners`, `blogs`, `cart`, `categories`, `collections`, `coupons`, `homepage`, `instagram-reels`, `media`, `orders`, `payments`, `products`, `reviews`, `seo`, `settings`, `stores`, `users`, `wishlist`.

### 2.2 Frontend

```
frontend/
├── Dockerfile                    3-stage; expects .next/standalone (see §25)
├── next.config.ts                images · emotion compiler · security headers
├── tsconfig.json                 strict, bundler resolution, @/* path aliases
├── .env / .env.local.example
├── app/                          Next.js 15 App Router
│   ├── layout.tsx                root: Redux → Query → Theme providers + Toaster
│   ├── globals.css
│   ├── error.tsx                 root error boundary
│   ├── robots.ts                 disallows /admin /account /checkout /cart /api
│   ├── sitemap.ts                dynamic: products + categories + blogs (revalidate 1h)
│   ├── (store)/                  ← public storefront
│   │   ├── layout.tsx            SSR fetch of public settings → Navbar/Footer
│   │   ├── page.tsx              homepage (SSR, parallel fetch, cache: no-store)
│   │   ├── loading.tsx           skeleton
│   │   ├── error.tsx
│   │   ├── shop/ search/ cart/ checkout/ wishlist/ order-success/
│   │   ├── product/[slug]/       SSR + JSON-LD Product schema (revalidate 120)
│   │   ├── category/[slug]/  collections/  collections/[slug]/
│   │   ├── blog/  blog/[slug]/
│   │   └── [page]/               catch-all CMS page renderer
│   ├── (admin)/                  ← admin panel
│   │   ├── layout.tsx            AuthInitializer + AdminLayoutClient
│   │   ├── error.tsx
│   │   └── admin/                dashboard, orders, products, categories,
│   │                             collections, customers, banners, homepage,
│   │                             blogs, coupons, reviews, media, reports,
│   │                             seo, settings, settings/gender
│   ├── (account)/                ← customer account
│   │   ├── layout.tsx
│   │   └── account/profile · addresses · orders · orders/[id]
│   └── (auth)/                   login · register
├── components/
│   ├── account/    AccountSidebar
│   ├── admin/      AdminLayoutClient          (sidebar, topbar, nav search, logout)
│   ├── blog/       BlogListClient
│   ├── cart/       CartDrawer
│   ├── category/   CategoryPageClient · CollectionPageClient
│   ├── common/     AuthInitializer · GenderInitializer · ErrorFallback
│   ├── home/       GenderHomePage · HeroSlider · ProductSection ·
│   │               CategoryShowcase · TestimonialsSection
│   ├── layout/     Navbar · Footer · MobileBottomNav
│   └── product/    ProductCard · ProductDetailClient
├── constants/index.ts            API_URL, sizes, colours, sort options, statuses
├── hooks/          useAuth · useCart
├── lib/axios.ts                  axios instance: auth header, refresh queue, error toasts
├── providers/      ReduxProvider · QueryProvider · ThemeProvider
├── services/api.service.ts       ← ALL API calls live here (18 grouped clients)
├── store/          index.ts + slices/{auth,cart,gender}Slice.ts
├── themes/index.ts               MUI theme (black + gold "luxury" palette)
├── types/index.ts                shared TS interfaces mirroring API payloads
├── utils/format.ts               formatPrice · formatDate · truncate · getInitials
├── assets/  public/
└── (no middleware.ts — route protection is client-side, see §15)
```

---

## 3. Technologies

| Layer | Technology | Version |
|---|---|---|
| Language | TypeScript | 5.4 (BE) / 5.x (FE) |
| Runtime | Node.js | 20 (alpine in Docker) |
| Backend framework | Express | 4.18 |
| Frontend framework | Next.js (App Router) | **15.5.19** (production `ud-c`) |
| UI runtime | React | 19 |
| ORM | Prisma | 5.22 |
| Database | MySQL | 8.x (provider `mysql`) |
| Process manager | PM2 | cluster mode, `instances: 'max'` |
| Container | Docker | multi-stage, both apps |
| Auth | JWT (access + refresh) | jsonwebtoken 9 |
| Image processing | Sharp | 0.33 |
| Logging | Winston | 3.13 |

---

## 4. Frameworks

### Backend — Express, layered by module

```
Request → helmet → CORS → rate-limit(prod) → body-parser(+rawBody) → cookieParser
        → xss-clean → compression → morgan(dev) → /uploads static
        → router → [authenticate] → [authorize] → [validate(Joi)] → [multer]
        → controller → service → Prisma → MySQL
        → sendSuccess/sendError → (on throw) errorHandler
```

`express-async-errors` is imported first in `app.ts`, so **async controllers can throw without try/catch** — rejections propagate to `errorHandler` automatically.

### Frontend — Next.js App Router, hybrid rendering

- **Server Components** fetch data with native `fetch` directly from the backend (homepage, product page, store layout, sitemap).
- **Client Components** (`'use client'`) handle interactivity and use `services/api.service.ts` (axios).
- Route groups `(store)` `(admin)` `(account)` `(auth)` isolate layouts without affecting URLs.

---

## 5. Libraries

### Backend

| Library | Purpose |
|---|---|
| `@prisma/client` | DB access, typed queries |
| `bcryptjs` | Password hashing (12 rounds) |
| `jsonwebtoken` | Access/refresh token signing |
| `google-auth-library` | Google OAuth ID-token verification |
| `razorpay` | Razorpay orders + HMAC signature verification |
| `cashfree-pg` | Cashfree PG SDK (`PGCreateOrder`, `PGFetchOrder`) |
| `joi` | Request-body schema validation |
| `express-validator` | **Declared but unused** — Joi is the standard |
| `multer` + `sharp` | Upload handling + WebP optimisation |
| `winston` + `morgan` | Structured logging + HTTP access logs (dev) |
| `helmet`, `cors`, `xss-clean`, `express-rate-limit` | Security middleware |
| `csurf` | **Declared but unused** (deprecated; API is stateless/JWT) |
| `compression`, `cookie-parser`, `dotenv`, `uuid`, `slugify`, `nodemailer` | Support |

### Frontend

| Library | Purpose |
|---|---|
| `@mui/material` 6 + `@emotion/*` | Component library + CSS-in-JS |
| `@mui/icons-material`, `@mui/lab` | Icons, lab components |
| `@mui/x-data-grid` 7 | Admin tables |
| `@reduxjs/toolkit` + `react-redux` | Global state: auth, cart, gender |
| `@tanstack/react-query` 5 | Query client configured; used sparingly |
| `@tanstack/react-table` 8 | Declared; DataGrid is preferred |
| `axios` | HTTP client with interceptors |
| `formik` + `yup` | Forms + validation |
| `framer-motion` | Animations |
| `swiper`, `react-slick` + `slick-carousel` | Carousels (two libraries in use) |
| `@dnd-kit/*` | Drag-and-drop reordering (homepage builder, banners) |
| `react-hot-toast` | Toasts (primary) |
| `notistack` | Snackbars (secondary — prefer `react-hot-toast`) |
| `next-themes`, `zustand` | **Declared but unused** — Redux + MUI theme are the standard |
| `critters` | Inlines critical CSS (`experimental.optimizeCss`) |

> **Rule:** do not introduce a new state or form library. Redux Toolkit + Formik/Yup + react-hot-toast are the sanctioned choices.

---

## 6. Build Commands

```bash
# ── Backend ────────────────────────────────────────────────
cd backend
npm ci                       # install (use ci, lockfile is committed)
npm run prisma:generate      # ALWAYS after editing schema.prisma
npm run build                # tsc → dist/
npm run lint                 # ⚠ no eslint config present — currently fails (§25)

# ── Frontend ───────────────────────────────────────────────
cd frontend
npm ci
npm run build                # next build
npm run type-check           # tsc --noEmit  ← use this as the real gate
npm run lint                 # ⚠ no eslint config present — currently fails (§25)
```

**Until ESLint configs are added, `npm run type-check` (frontend) and `npm run build` (backend) are the quality gates.**

---

## 7. Run Commands

```bash
# ── Backend ────────────────────────────────────────────────
npm run dev                  # ts-node-dev --respawn --transpile-only src/server.ts
npm start                    # build + node dist/server.js
npm run prisma:push          # push schema to DB (no migration files)  ← current practice
npm run prisma:migrate       # create a migration (not currently used)
npm run prisma:studio        # DB browser on :5555
npm run seed:gender          # idempotent demo data (10 products, 5 banners)

# ── Frontend ───────────────────────────────────────────────
npm run dev                  # next dev  → http://localhost:3000
npm start                    # next start (requires a prior build)

# ── Production (PM2) ───────────────────────────────────────
cd backend && npm run build && pm2 start ecosystem.config.js
pm2 logs luxestore-api · pm2 restart luxestore-api · pm2 save
```

### First-run behaviour (important)

`src/server.ts` runs `initDatabase()` on **every boot**. It is **idempotent by design** — every block uses `createMany({ skipDuplicates: true })` or a count guard, so **admin edits are never overwritten**. It seeds: 18 settings, a SUPER_ADMIN (only if none exists), 10 categories, 5 collections, 8 homepage sections, 3 banners, 6 testimonials, 4 coupons, 3 SEO records, 6 CMS pages.

Default admin: `ADMIN_EMAIL` env or `admin@uniquedressup.com` / `ADMIN_PASSWORD` env or `Admin@123`.
**Change `ADMIN_PASSWORD` before any production boot.**

---

## 8. Environment Variables

### 8.1 Backend (`backend/.env`)

Validated at startup: in `NODE_ENV=production`, missing `JWT_SECRET`, `JWT_REFRESH_SECRET`, or `DATABASE_URL` causes `process.exit(1)`.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | Gates rate limiting, morgan, Prisma query logs, `isVerified` on register |
| `PORT` | `5000` | |
| `BASE_URL` | `http://localhost:5000` | Used to build public image URLs **and** the Cashfree `notify_url` |
| `DATABASE_URL` | — | **Required in prod.** `mysql://user:pass@host:3306/db` |
| `JWT_SECRET` | `fallback_secret_change_in_production` | **Required in prod** |
| `JWT_REFRESH_SECRET` | `fallback_refresh_secret` | **Required in prod** |
| `JWT_EXPIRE` | `1d` | Access token TTL |
| `JWT_REFRESH_EXPIRE` | `30d` | Refresh token TTL |
| `UPLOAD_PATH` | `./uploads` | Must be a persistent volume in Docker |
| `MAX_FILE_SIZE` | `5242880` (5 MB) | Banners override to 1 MB, stores to 2 MB |
| `ALLOWED_IMAGE_TYPES` | `image/jpeg,image/jpg,image/png,image/webp` | CSV |
| `FRONTEND_URL` | `http://localhost:3000` | CORS allow-list |
| `ADMIN_URL` | `http://localhost:3000/admin` | CORS allow-list |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Production only |
| `RATE_LIMIT_MAX` | `500` | Production only; auth routes hard-capped at 20 / 15 min |
| `BCRYPT_ROUNDS` | `12` | |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | `''` | Lazily validated on first use |
| `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` | `''` | **Absent from the current `.env`** (§25) |
| `CASHFREE_ENV` | `sandbox` | `sandbox` \| `production` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `''` | Google sign-in |
| `SMTP_HOST/PORT/USER/PASS`, `FROM_EMAIL`, `FROM_NAME` | gmail defaults | **Configured but no mailer is implemented yet** |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@uniquedressup.com` / `Admin@123` | Seed-time only |

### 8.2 Frontend (`frontend/.env`)

| Variable | Consumed by | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | — | ⚠ **Currently ignored** — `constants/index.ts` hardcodes the API URL (§25) |
| `NEXT_PUBLIC_SITE_URL` | `SITE_URL` → metadata, sitemap, robots | |
| `NEXT_PUBLIC_SITE_NAME` | `SITE_NAME` → titles | |
| `NEXT_PUBLIC_RAZORPAY_KEY` | checkout page | Razorpay public key |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google sign-in | |
| `NEXT_PUBLIC_DEFAULT_CURRENCY` / `_SYMBOL` | `formatPrice` | `INR` / `₹` |
| `BACKEND_URL` | **server-side only** — store layout, `sitemap.ts` | Server-to-server base (no `/api/v1` suffix in store layout; sitemap appends it) |
| `NEXT_OUTPUT` | `next.config.ts` | Must be `standalone` for the Docker build to work (§25) |

> `NEXT_PUBLIC_*` values are **inlined into the client bundle at build time**. Never put a secret behind that prefix. Rebuild after changing one.

---

## 9. Coding Standards

### Universal

1. **TypeScript `strict` is on in both projects.** Do not disable it or add `// @ts-ignore` to silence a real type error.
2. `any` is tolerated at gateway/SDK boundaries (Prisma dynamic `where`, Cashfree/Razorpay responses, FormData coercion) — **not** in new domain logic.
3. 2-space indent, single quotes, semicolons, trailing commas in multi-line literals.
4. Comments explain **why**, never **what**. The existing codebase does this well (see the webhook idempotency comment block in `payment.controller.ts:269-276`) — match that standard.
5. Section dividers `// ─── Name ────` are the house style in long files. Keep them.

### Backend specifics

- **Controllers** parse/validate input, call a service or Prisma, and return via `sendSuccess`/`sendError`. No business rules in routes.
- **Services** own multi-step business logic and transactions. Add a service the moment a controller exceeds ~40 lines of logic.
- Every controller class is exported as **both the class and a singleton instance** (`export const productController = new ProductController()`), and routes bind methods explicitly: `controller.method.bind(controller)`. **Always `.bind()`** — several controllers use `this` internally (e.g. `CartController.getOrCreateCart`).
- Throw `new AppError(message, statusCode)` for expected failures. Never `res.status(500).send()` by hand.
- Money is `Decimal` in Prisma. Wrap in `Number(...)` for arithmetic; never compare `Decimal` with `===`.

### Frontend specifics

- Default to **Server Components**. Add `'use client'` only for state, effects, or event handlers.
- **All HTTP goes through `services/api.service.ts`.** Do not call `axios` or `fetch` directly from a component. (Server Components fetching at render time are the documented exception, and they must use `API_URL`/`BACKEND_URL` from config.)
- Styling is **MUI `sx` props** with theme tokens. No CSS modules, no styled-components, no Tailwind.
- Forms: **Formik + Yup**. Toasts: **react-hot-toast**.
- Every async UI surface needs three states: **loading (skeleton) → error → empty**.

---

## 10. Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Backend file | `<name>.<layer>.ts` | `product.service.ts`, `auth.routes.ts` |
| Backend module dir | kebab-case | `instagram-reels/` |
| Class | PascalCase | `ProductService`, `AppError` |
| Singleton export | camelCase | `productService`, `paymentController` |
| Function / variable | camelCase | `getProductBySlug`, `shippingCharge` |
| Constant | UPPER_SNAKE | `SHIPPING_RATES`, `ALLOWED_ORIGINS` |
| React component file | PascalCase.tsx | `ProductCard.tsx` |
| Hook | `use` + camelCase | `useCart.ts` |
| Redux slice | `<domain>Slice.ts` | `cartSlice.ts` |
| API client group | `<domain>Api` | `productApi`, `orderApi` |
| Next.js route file | lowercase reserved | `page.tsx`, `layout.tsx`, `error.tsx` |
| Prisma model | PascalCase singular | `ProductVariant` |
| DB table (`@@map`) | snake_case plural | `product_variants` |
| Prisma enum value | UPPER_SNAKE | `OUT_FOR_DELIVERY` |
| API route segment | kebab-case plural | `/api/v1/instagram-reels` |
| Query param | camelCase | `?categorySlug=&sortBy=price_asc` |
| Settings key | snake_case | `free_shipping_threshold` |

---

## 11. API Standards

### 11.1 Base

All routes are mounted under `/api/v1`. Version by adding `/api/v2` — never break v1 in place.

### 11.2 Response envelope — mandatory

Produced only by `src/utils/response.ts`.

```jsonc
// success
{ "success": true,  "message": "Success", "data": { } }

// paginated (sendPaginated)
{ "success": true,  "message": "Success", "data": [ ],
  "meta": { "total": 120, "page": 1, "limit": 20, "totalPages": 6 } }

// error
{ "success": false, "message": "Product not found" }

// validation error (422)
{ "success": false, "message": "Validation failed",
  "errors": [ { "field": "email", "message": "\"email\" must be a valid email" } ] }
```

In development only, the error handler also appends `stack`.

### 11.3 Status codes

| Code | Used for |
|---|---|
| 200 | Successful GET / PUT / DELETE |
| 201 | Resource created (`sendSuccess(res, data, msg, 201)`) |
| 400 | Business-rule violation (insufficient stock, invalid coupon, bad signature) |
| 401 | Missing / invalid / expired token |
| 403 | Authenticated but wrong role, or resource belongs to another user |
| 404 | Not found (including the global `notFound` handler) |
| 409 | Conflict (duplicate email on register) |
| 422 | Joi validation failure |
| 429 | Rate limited (production only) |
| 500 | Unhandled |

### 11.4 Conventions

- Pagination: `?page=1&limit=20`. `paginationParams()` clamps `limit` to **1–100** and `page` to ≥1.
- Public list endpoints return only `isActive: true, deletedAt: null` rows. Admin endpoints live under `/admin/*` sub-paths (`/blogs/admin/all`, `/products/admin/:id`, `/homepage/admin`, `/seo/admin/*`, `/stores/admin`, `/instagram-reels/admin`).
- Guest identity travels in the `x-session-id` header (allow-listed in CORS).
- File uploads are `multipart/form-data` via `createUploader(folder, maxBytes?)`.
- Reorder endpoints take `{ items: [{ id, sortOrder }] }` and run inside `prisma.$transaction`.
- **Product image order is the exception to that shape.** `PUT /products/:id` takes an ordered
  `imageOrder` token list alongside the upload, because a reorder can involve files that have no id
  yet. Tokens are either an existing `ProductImage.id` or `new:<n>` — the nth file appended to
  `images` in the *same* request. `ProductImage.sortOrder` is the single source of truth and
  `isPrimary` is derived from it (position 0), so the listing thumbnail (`take: 1`) can never
  disagree with the first image in the detail gallery. `applyImageOrder()` renumbers to 0..n-1 on
  every update; with no `imageOrder` it still runs as a normalisation pass, closing gaps and
  breaking ties by `createdAt`. Unresolvable tokens are skipped and unmentioned images appended, so
  a concurrent edit degrades to a reorder rather than dropping images. Admin UI is
  `components/admin/SortableImageGrid.tsx` (dnd-kit), shared by the add and edit product forms;
  order is submitted with the form, not auto-saved.
- **Images can be tagged to a colour.** `PUT /products/:id` also takes `imageColors`, a map keyed
  by the *same* tokens as `imageOrder` (an existing `ProductImage.id`, or `new:<n>`), whose values
  set `ProductImage.color`. `null` means the image belongs to the default set. The storefront
  resolves the gallery with `lib/productImages.ts:galleryFor()`: shots for the chosen colour →
  otherwise the untagged shots → otherwise everything. That middle step is the one that matters —
  a product offered in two colours but photographed once keeps showing that photoshoot for both.
  Colours match by name, case- and space-insensitively, and are **not** validated against the
  variants: admins upload photos before adding variant rows, so a tag matching nothing simply never
  wins the filter rather than being rejected.

---

## 12. Folder Guidelines

### Adding a backend module

```
src/modules/<module>/
├── controllers/<module>.controller.ts   # required
├── routes/<module>.routes.ts            # required
├── services/<module>.service.ts         # add when logic > ~40 lines or needs a transaction
└── validators/<module>.validators.ts    # add for any user-writable payload
```

Then register in `src/app.ts`:

```ts
import xRoutes from './modules/x/routes/x.routes';
app.use(`${v1}/x`, xRoutes);
```

**Rules**
- One module = one domain concept. Never import another module's controller; share via `utils/` or a service.
- `src/validators/` and `src/jobs/` are empty placeholders — put validators **inside** the module.
- Route ordering matters: static paths **before** parameterised ones (`/reorder` before `/:id`, as `banner.routes.ts` and `store.routes.ts` already do). Getting this wrong makes `/reorder` match `/:id`.

### Adding a frontend page

- Storefront → `app/(store)/<route>/page.tsx`; admin → `app/(admin)/admin/<route>/page.tsx`.
- Data-heavy + SEO-relevant → Server Component with `fetch`. Interactive → thin server page + `<XClient />` in `components/`.
- Add API calls to the matching group in `services/api.service.ts`; add types to `types/index.ts`.
- Reusable across ≥2 pages → `components/common/`. Otherwise co-locate by domain folder.

---

## 13. Database Overview

**MySQL 8** via Prisma. 34 models, 13 enums. All PKs are `String @default(uuid())`.

### Migration strategy — read this before touching the schema

`prisma/migrations/` is **empty**. The schema is applied with `npm run prisma:push` (`prisma db push`). There is **no migration history and no rollback path**.

> **Consequence:** `db push` can drop columns/tables to converge the schema. Before running it against production: take a `mysqldump`, review the printed plan, and never run it unattended. Introducing proper `prisma migrate` is a tracked improvement (§26).

### Domain groups

| Group | Models |
|---|---|
| Users & auth | `User`, `SubAdmin`, `Address` |
| Catalog | `Category`, `Collection`, `ProductCollection`, `Product`, `ProductImage`, `ProductVariant`, `ProductTag`, `ProductBadge`, `ProductFaq`, `RelatedProduct` |
| Inventory | `InventoryLog` |
| Social proof | `Review`, `Testimonial` |
| Commerce | `Cart`, `CartItem`, `WishlistItem`, `Order`, `OrderItem`, `Payment`, `Coupon`, `ReturnRequest` |
| Content | `Banner`, `HomepageSection`, `Blog`, `BlogCategory`, `BlogTag`, `CmsPage`, `SeoMeta`, `Media`, `Store`, `InstagramReel`, `NavMenu` |
| Platform | `Setting`, `Notification`, `RecentlyViewed` |

### Key conventions

- **Soft delete** via `deletedAt` on `User`, `Category`, `Product`, `Blog`. Every public query **must** include `deletedAt: null`.
- **Money** is `Decimal(10,2)`; `taxPercent` is `Decimal(5,2)` default 18; `avgRating` is `Decimal(3,2)`.
- **Denormalised counters** on `Product`: `totalReviews`, `avgRating`, `totalSold`, `viewCount`. Keep them in sync when writing related rows.
- **Order snapshots**: `OrderItem` copies `name/image/size/colour/sku/price`, and `Order.shippingAddress`/`billingAddress` are `Json`. Historical orders must never change when a product is edited — preserve this.
- **Gender** is a plain `String` (not an enum) on `Product` (default `"UNISEX"`), `Category`, `Banner` (default `"ALL"`), and `InstagramReel` (default `"ALL"`). Filters match `{ gender: { in: [SELECTED, 'UNISEX'] } }` for products, `{ in: [SELECTED, 'ALL'] } }` for banners and reels. The neutral value differs by model — `UNISEX` for catalogue rows, `ALL` for creative rows — so check which one you are filtering before copying a where-clause.
- `BigInt.prototype.toJSON` is patched in `app.ts:5` so raw `COUNT`/`SUM` results serialise. Do not remove it — the analytics `$queryRaw` calls depend on it.

### Indexes present

`users(email, role)`, `categories(slug, parentId)`, `collections(slug)`, `products(slug, categoryId, gender, [isActive,isFeatured], [isActive,isTrending], [isActive,isNewArrival])`, `product_images(productId)`, `product_variants(productId)`, `product_tags(productId, tag)`, `reviews(productId, userId)`, `cart_items(cartId)`, `wishlist_items(userId + unique[userId,productId])`, `orders(userId, orderNumber, status)`, `order_items(orderId)`, `payments(orderId)`, `coupons(code)`, `banners([type,isActive], gender)`, `homepage_sections([type,isActive])`, `blogs(slug, isPublished)`, `cms_pages(slug)`, `media_library(folder)`, `settings(group)`, `notifications([userId,isRead])`, `nav_menus([position,isActive])`.

---

## 14. Authentication Flow

**Stateless JWT.** Access token in the `Authorization: Bearer` header; refresh token persisted on `User.refreshToken` (single active session per user — a new login invalidates the previous refresh token).

### Registration / login

```
POST /api/v1/auth/register  → Joi validate → email uniqueness (409)
                            → bcrypt hash (12) → create User (isVerified = isDev)
                            → sign access + refresh → persist refreshToken
                            → { user, accessToken, refreshToken }

POST /api/v1/auth/login     → lookup by email where deletedAt: null
                            → 401 if absent / no password  (generic message)
                            → 403 if !isActive
                            → bcrypt.compare → 401 on mismatch
                            → rotate tokens + set lastLoginAt
```

### Google OAuth

`POST /auth/google` verifies the Google ID token via `OAuth2Client.verifyIdToken`, then creates the user (`isVerified: true`, role `CUSTOMER`) or links `googleId` to an existing email.

### Refresh

```
POST /auth/refresh { refreshToken }
  → verify against JWT_REFRESH_SECRET
  → load user; reject unless user.isActive AND user.refreshToken === presented token
  → issue a NEW pair and overwrite the stored refreshToken (rotation)
```

### Token payload

```ts
{ userId: string, email: string, role: string }   // + iat, exp
```

`authenticate` re-reads the user from the DB on **every** request and attaches `dbRole` — so a role change or deactivation takes effect immediately, without waiting for token expiry. **Authorisation always uses `dbRole`, never the JWT `role` claim.**

### Frontend side

- Tokens live in `localStorage` (`accessToken`, `refreshToken`), written by the `authSlice.setCredentials` reducer.
- `lib/axios.ts` attaches the bearer token and an `x-session-id` (generated once via `crypto.randomUUID()`).
- On **401**, the interceptor performs a **single-flight refresh**: concurrent 401s queue on `refreshQueue` and replay after one refresh completes. On refresh failure it clears storage and hard-redirects to `/login`.
- `AuthInitializer` (mounted in the store, admin, and account layouts) calls `GET /auth/me` on load to rehydrate the user, then warms the cart.
- Password reset / change and logout all null out `refreshToken`, forcing re-authentication everywhere.

### Not yet implemented

Email delivery. `forgotPassword` generates and stores a token with a 1-hour expiry and **returns it to the caller** — no email is sent (SMTP config exists, no mailer module). Wiring a mailer is required before the reset flow is production-usable.

---

## 15. Authorization Flow

### Roles

| Role | Scope |
|---|---|
| `SUPER_ADMIN` | Everything; seeded on first boot |
| `ADMIN` | Full admin panel; all destructive operations |
| `SUB_ADMIN` | Catalog + order operations; **cannot** delete products/categories/variants. `SubAdmin.permissions` (Json) exists in the schema but is **not enforced anywhere yet** |
| `CUSTOMER` | Own cart, orders, addresses, reviews, wishlist |

### Guards (`src/middlewares/auth.middleware.ts`)

```ts
authenticate                                        // 401 if no/invalid token or inactive user
authorize(...roles)                                 // 403 unless dbRole ∈ roles
isAdmin            = authorize(ADMIN, SUPER_ADMIN)
isAdminOrSubAdmin  = authorize(ADMIN, SUPER_ADMIN, SUB_ADMIN)
isSuperAdmin       = authorize(SUPER_ADMIN)
```

### Ownership checks

Role guards are not enough for user-owned resources. The codebase enforces ownership explicitly:

- `orderService.getOrderById(id, userId)` scopes the query by `userId`.
- `cancelOrder` matches `{ id, userId, status: { in: ['PENDING','CONFIRMED'] } }`.
- Every payment endpoint re-checks `order.userId !== req.user.userId → 403`.

**Any new endpoint touching a user-owned row must do the same.** A role check alone is an IDOR.

### Optional auth (guest support)

`cart.routes.ts` defines a local `optionalAuth`: if an `Authorization` header exists it runs `authenticate`, otherwise it passes through and the controller falls back to the `x-session-id` header.

### Frontend route protection

There is **no `middleware.ts`**. `AdminLayoutClient` redirects non-admins in a `useEffect`, and `checkout` redirects unauthenticated users. This is **UX-level only** — admin pages briefly render before redirecting, and the check is bypassable client-side. **Security is enforced server-side by `isAdmin`/`isAdminOrSubAdmin`**, which is what actually matters; adding Next middleware is a tracked improvement (§26).

---

## 16. Frontend Architecture

### Provider tree (`app/layout.tsx`)

```
<html><body>
  <ReduxProvider>            store: auth · cart · gender
    <QueryProvider>          staleTime 60s · retry 1 · no refetch on focus
      <ThemeProvider>        MUI theme + CssBaseline
        {children}
        <Toaster />          react-hot-toast, top-right
```

### Rendering strategy per route

| Route | Strategy | Cache |
|---|---|---|
| `(store)/page.tsx` | Server Component, 6 parallel fetches | `no-store` |
| `(store)/layout.tsx` | Server; fetches `/settings/public` for Navbar/Footer | `no-store` |
| `product/[slug]` | Server + `generateMetadata` + JSON-LD `Product` schema | `revalidate: 120` |
| `[page]` (CMS) | Server | `revalidate: 3600` |
| `sitemap.ts` | Server, up to 500 products + categories + blogs | `revalidate: 3600` |
| shop / search / cart / checkout / wishlist | Client Components | axios |
| all `(admin)/*` | Client Components | axios |

Every server-side fetch is wrapped in `try/catch` returning `null`/`[]`, so a backend outage degrades to an empty page rather than a 500.

### State ownership

| State | Home | Notes |
|---|---|---|
| Auth (user, token, isAuthenticated) | Redux `authSlice` | Mirrors tokens into `localStorage` |
| Cart (items, itemCount, subtotal, drawer open) | Redux `cartSlice` | Totals recomputed in the reducer |
| Gender toggle | Redux `genderSlice` | Persisted to `localStorage` key `ud_gender` |
| Server data | Component state / RSC props | React Query available but under-used |
| Theme | MUI `ThemeProvider` | Single light theme |

`serializableCheck` is disabled in the store config.

### Design system (`themes/index.ts`)

Black-and-gold luxury palette: primary `#1a1a1a`, secondary/gold `#c9a84c`, plus a custom `palette.luxury` ( `gold`, `darkGold`, `cream #f8f4ef`, `charcoal #2c2c2c`, `midnight #0d0d0d` ) declared via MUI module augmentation. Headings use **Playfair Display**, body uses **Inter**. `borderRadius: 2` (nearly square), uppercase buttons with `0.12em` letter-spacing, a full custom 25-step shadow scale, and `responsiveFontSizes()` applied. Use these tokens — do not hardcode new brand colours.

---

## 17. Backend Architecture

### Layers

```
routes/       HTTP surface: path, middleware chain, controller binding. No logic.
controllers/  Parse req → call service/Prisma → sendSuccess/sendError. Thin.
services/     Business rules, transactions, invariants. Throw AppError.
config/       env + PrismaClient singleton.
utils/        Cross-cutting helpers, zero domain knowledge.
middlewares/  auth, validation, error handling.
```

Services exist today for `auth`, `orders`, `products`. Other modules call Prisma directly from the controller — acceptable while logic is trivial; **promote to a service the moment a transaction or multi-entity rule appears.**

### Middleware order in `app.ts` (order is load-bearing)

1. `helmet` (`crossOriginResourcePolicy: cross-origin` so `/uploads` is embeddable)
2. **CORS** — allow-list = `FRONTEND_URL`, `ADMIN_URL`, and localhost/127.0.0.1 on :3000/:3001. Requests with **no** `Origin` header (curl, Postman, server-to-server, the Cashfree webhook) are allowed. `credentials: true`; `x-session-id` is an allowed header.
3. **Rate limiting — production only.** Global `/api` limiter + a stricter 20-per-15-min limiter on `/auth/login` and `/auth/register`. Disabled in dev to avoid 429s during active work.
4. `express.json({ limit: '10mb', verify })` — the `verify` hook stashes the raw buffer on `req.rawBody`, which the **Cashfree webhook signature check depends on**. Do not remove it.
5. `cookieParser` → `xss-clean` → `compression` → `morgan` (dev only)
6. `/uploads` static with `Cache-Control: public, max-age=86400`
7. `GET /health` → `{ status: 'OK', timestamp }`
8. 20 route groups under `/api/v1`
9. `notFound` → `errorHandler` (must stay last)

`app.set('trust proxy', 1)` is set for correct client IPs behind Nginx.

### Graceful shutdown

`SIGTERM`/`SIGINT` → stop accepting connections → `prisma.$disconnect()` → exit 0, with a 10-second `unref`'d force-exit timer. `uncaughtException` triggers the same path; `unhandledRejection` is logged only.

---

## 18. API Documentation

Base URL: `{BASE_URL}/api/v1`. **Auth legend:** 🔓 public · 🔐 authenticated · 👑 admin (`isAdmin`) · 🛡 admin-or-sub-admin · ⭐ super-admin

### Auth — `/auth`
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/register` | 🔓 | Joi: names 2–50, email, password ≥8, phone `^[6-9]\d{9}$` |
| POST | `/login` | 🔓 | Rate-limited in prod |
| POST | `/google` | 🔓 | `{ token }` = Google ID token |
| POST | `/refresh` | 🔓 | Rotates both tokens |
| POST | `/logout` | 🔐 | Nulls `refreshToken` |
| POST | `/forgot-password` | 🔓 | Returns token in response — **no email sent yet** |
| POST | `/reset-password` | 🔓 | `{ token, password }` |
| PUT | `/change-password` | 🔐 | Invalidates refresh token |
| GET | `/me` | 🔐 | Current user |

### Products — `/products`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | 🔓 | Filters: `page limit search categoryId categorySlug collectionSlug minPrice maxPrice sizes colors brands isFeatured isTrending isNewArrival isBestSeller inStock rating gender sortBy` |
| GET | `/featured` `/trending` `/new-arrivals` `/best-sellers` | 🔓 | `?limit=8&gender=MEN` |
| GET | `/search` | 🔓 | Name / brand / tag match |
| GET | `/:slug` | 🔓 | Full detail; **increments `viewCount`** |
| GET | `/admin/:id` | 🛡 | Includes inactive + all variants |
| POST | `/` | 🛡 | `multipart`, up to 10 images |
| PUT | `/:id` | 🛡 | `multipart`; normalises primary image |
| DELETE | `/:id` | 👑 | **Soft delete** (`deletedAt` + `isActive: false`) |
| GET/POST | `/:id/variants` | 🛡 | |
| PUT | `/:id/variants/:vid` | 🛡 | |
| DELETE | `/:id/variants/:vid` | 👑 | Hard delete |

`sortBy`: `price_asc` · `price_desc` · `newest` (default) · `popular` · `rating` · `name`.

### Categories — `/categories`
`GET /` `/featured` `/nav-menu` `/parents` `/home` `/:slug` 🔓 · `POST /` `PUT /:id` 🛡 (multipart, single `image`) · `DELETE /:id` 👑

### Collections — `/collections`
`GET /` `/:slug` 🔓 · `POST /` `PUT /:id` `DELETE /:id` 👑 · `GET|POST /:id/products`, `DELETE /:id/products/:productId` 👑

### Cart — `/cart` (all `optionalAuth`; guests use `x-session-id`)
`GET /` · `POST /add` `{productId, variantId?, quantity=1}` · `PUT /item/:itemId` `{quantity}` (qty<1 deletes) · `DELETE /item/:itemId` · `DELETE /clear` · `POST /coupon` `{code, cartTotal}`

### Orders — `/orders`
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/` | 🔐 | Transactional: stock check → totals → coupon → create → decrement stock |
| GET | `/my` | 🔐 | Paginated |
| GET | `/track/:orderNumber` | 🔓 | **Unauthenticated** — order number is the only secret |
| GET | `/:id` | 🔐 | Scoped to the caller |
| POST | `/:id/cancel` | 🔐 | Only from `PENDING`/`CONFIRMED` |
| GET | `/` | 🛡 | Filters: `status paymentStatus search startDate endDate` |
| PUT | `/:id/status` | 🛡 | Sets `deliveryDate` when `DELIVERED` |

### Payments — `/payments`
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/razorpay/create` | 🔐 | Returns `{razorpayOrderId, amount, currency, key}` |
| POST | `/razorpay/verify` | 🔐 | HMAC-SHA256 of `order_id\|payment_id` |
| POST | `/cashfree/create` | 🔐 | Returns `payment_session_id`; 30-min expiry |
| POST | `/cashfree/cod-deposit` | 🔐 | Collects **only** the delivery charge online |
| GET | `/cashfree/status/:orderId` | 🔐 | Polls Cashfree; self-heals a missed webhook |
| POST | `/cashfree/webhook` | 🔓 | Server-to-server; signature-verified |

### Users — `/users`
`PUT /profile` (multipart `avatar`) · `GET|POST /addresses`, `PUT|DELETE /addresses/:id` · `GET|POST /recently-viewed` · `GET /notifications`, `PUT /notifications/read` — all 🔐
`GET /` · `PUT /:id` · `PUT /:id/toggle-status` — 👑

### Remaining groups
| Group | Public | Admin |
|---|---|---|
| `/wishlist` | — | `GET /`, `POST /toggle`, `GET /check/:productId` (all 🔐) |
| `/reviews` | `GET /product/:productId` | `POST /` 🔐 · `GET /`, `PUT /:id`, `PUT /:id/status`, `DELETE /:id` 👑 |
| `/banners` | `GET /type/:type` | `GET /`, `POST /`, `PUT /reorder`, `PUT /:id`, `DELETE /:id` 👑 · image cap = `MAX_FILE_SIZE` |
| `/coupons` | `POST /validate`, `GET /:code/check` | CRUD 👑 |
| `/homepage` | `GET /`, `GET /data` | `GET /admin`, `POST /`, `PUT /reorder`, `PUT /:id`, `DELETE /:id` 👑 |
| `/blogs` | `GET /`, `/categories`, `/:slug` | `GET /admin/all`, `POST /`, `PUT /:id`, `DELETE /:id` 👑 |
| `/analytics` | — | `GET /dashboard`, `GET /revenue` 👑 |
| `/settings` | `GET /public` | `GET /`, `GET /:group`, `POST /`, `POST /bulk` 👑 |
| `/seo` | `GET /page/:page`, `GET /cms/:slug` | `GET /admin/all`, `PUT /admin/:id`, `POST /admin/upsert`, `GET /admin/cms`, `POST /admin/cms` 👑 |
| `/media` | — | `GET /`, `POST /upload` (≤20 files), `DELETE /:id` 👑 |
| `/stores` | `GET /` | `GET /admin`, `POST /`, `PUT /reorder`, `PUT /:id`, `DELETE /:id` 👑 · **2 MB cap** |
| `/nav-menus` | `GET /?position=&gender=` | `GET /admin`, `POST /`, `PATCH /positions`, `POST /import-defaults`, `PUT /:id`, `DELETE /:id` 🛡 |
| `/instagram-reels` | `GET /?gender=` | `GET /admin?gender=&isActive=`, `POST /`, `PATCH /reorder`, `PUT /:id`, `DELETE /:id` 🛡 |

---

## 19. Common Components & Reusable Modules

### Backend utilities — use these, don't reinvent

| Helper | Signature | Use |
|---|---|---|
| `sendSuccess` | `(res, data, message?, status=200, meta?)` | Every success response |
| `sendError` | `(res, message?, status=500, errors?)` | Every error response |
| `sendPaginated` | `(res, data[], total, page, limit, message?)` | Every list endpoint |
| `AppError` | `new AppError(msg, status)` | Expected failures |
| `validate(schema, source?)` | Express middleware | Joi validation; `stripUnknown: true` |
| `createUploader(folder, maxBytes?)` | multer instance | Uploads; folders: products, banners, categories, blogs, users, media, stores |
| `optimizeImage(in, out?, opts?)` | → path | Sharp → WebP, default width 1200 / quality 85. **Legacy** — used only by banners/stores; new code should rely on the derivative pipeline below |
| `handleUpload(mw, maxBytes?)` | Express middleware | Wraps a multer middleware so oversize/invalid uploads return a clean 400 stating the limit |
| `getImageUrl(path)` | → absolute URL | Builds `${BASE_URL}/uploads/...` |
| `deleteFile(path)` | → void | Unlink, swallows ENOENT |
| `createSlug(text)` | → slug | lower, strict, trimmed |
| `generateOrderNumber()` | → `ORD-<base36ts>-<rand>` | |
| `paginationParams(page?, limit?)` | → `{page, limit, skip}` | Clamps limit 1–100 |
| `logger` | winston | Never `console.log` in backend code |

### Image delivery pipeline

**Principle: store big, serve small.** Originals are kept untouched at full quality; the storefront never receives them.

| Piece | Location | Role |
|---|---|---|
| `imagePipeline.ts` | `src/utils/` | Sharp transforms, disk cache, LQIP, background queue |
| `/img/<path>?w=&f=&q=` | `modules/images` | Serves a cached derivative; negotiates AVIF/WebP from `Accept` |
| `/img/meta/<path>` | `modules/images` | `{ width, height, lqip }` for blur-up placeholders |
| `prewarmDerivatives()` | hooked into `getImageUrl()` | Generates common widths in the background on every upload |
| `npm run images:warm` | `src/scripts/` | Backfills derivatives for images uploaded before the pipeline existed |
| `lib/imageLoader.ts` | frontend | `next/image` custom loader; rewrites `/uploads/…` → `/img/…` |

**Rules**
- **The WOMEN/MEN preference lives in the `ud_gender` cookie, not localStorage.** The homepage is
  server-rendered, so the server has to know the gender at request time; when the preference was
  localStorage-only, SSR fetched with *no* gender filter and a reload with MEN selected left the
  toggle on MEN while the products stayed unfiltered. `lib/genderPreference.ts` owns reading and
  writing it (localStorage is still written for shoppers who set a preference before the cookie
  existed). `/` reads it via `cookies()` and passes `initialGender` down; `/homepage/data` and the
  `/products/*` list endpoints all take `?gender=`. The page is already `cache: 'no-store'` and
  nginx does not cache HTML, so per-cookie rendering is safe — do not add HTML caching to `/`
  without a `Vary: Cookie`.
- **The Redux store is a module singleton**, so it cannot be seeded per SSR request without leaking
  one visitor's state into another's render. Gender-dependent components therefore render the
  server's `initialGender` until `gender.initialized` flips, rather than the store's WOMEN default.
- **The hero box tracks the artwork's aspect ratio, it does not set its own height.** Banner masters
  are cropped server-side to 1440:560 (2.57:1). `HeroSlider` previously used fixed pixel heights per
  breakpoint (xs 260, sm 400, md 500); a phone viewport is far taller relative to its width than
  2.57:1, so `object-fit: cover` sliced the sides off — at 390px wide only **58% of the banner width
  survived**, cutting through headlines baked into the artwork. Below 1200px the container now uses
  `aspect-ratio: 1440 / 560` with `height: auto`, so cover has nothing left to crop. Above 1200px it
  keeps a fixed 580px, where the true ratio would be 747px tall and push the page below the fold.
  If you change the backend crop ratio, change `HERO_ASPECT` with it or the crop returns.
- **A `mobileImage` is the only way to get a tall mobile hero.** Wide artwork at 390px is a ~152px
  strip — complete, but short. Uploading a portrait crop switches the box to 4:5 at the same 768px
  the `<picture>` source switches, which is what art direction is for. No banner currently has one.
- **Framing is chosen at upload time, in the browser.** `components/common/ImageCropperProvider.tsx`
  wraps the admin and account layouts and exposes `useImageCropper()` /
  `useImageCropperBatch()`, which resolve to the file to upload (or `null` if the admin backs out).
  Every image picker in the panel goes through it. The pipeline can decide *how* to encode an image
  but not *which part of it matters*, and `object-fit: cover` discards the rest silently — the crop
  dialog moves that choice to the person who knows what the subject is. `CROP_PRESETS` holds one
  entry per surface; its `aspect` mirrors the storefront component's own box and its `minWidth`
  mirrors `MIN_SOURCE_WIDTH` below. **Change one and change the other**, or the dialog will produce
  crops the server then rejects. The exporter (`lib/imageCrop.ts`) never upscales, meets a byte
  budget by lowering quality first and resolution second but never past `minWidth`, applies EXIF
  orientation, and returns an untouched file unchanged rather than re-encoding it for nothing.
- **Source resolution is the one thing the pipeline cannot fix.** It never upscales by design, so a source narrower than its render box is stretched by the *browser* — that is what "the image looks blurry" almost always means. `validateUploadResolution` rejects uploads below `MIN_SOURCE_WIDTH` (products 1000px, categories 800px, banners 1440px); `npm run images:audit` lists existing offenders. Set `IMAGE_MIN_RESOLUTION_ENFORCE=false` to warn instead of reject.
- **`PIPELINE_VERSION` must be bumped whenever encoder settings change.** The cache key is otherwise source identity + width/format/quality only, so a settings change would keep serving derivatives from the old encoder forever. Bumping it invalidates everything; follow with `npm run images:warm`.
- AVIF uses **4:4:4** chroma. 4:2:0 halves colour resolution and softens print edges on garments — measured 39.80 dB PSNR vs **41.43 dB** at 4:4:4 (past the ~40 dB visually-lossless line) for ~9% more bytes.
- A **damped unsharp mask** (`sigma 0.5, m1/m2 0.5`) is applied only when downscaling ≥1.5×, where resampling has actually cost acutance. Sharp's default `m1/m2` (1.0/2.0) inflate AVIF ~27% and halo garment edges; the damped settings cost ~8%.
- Widths are snapped to a fixed ladder (`RESPONSIVE_WIDTHS`); arbitrary widths cannot balloon the cache.
- Cache keys include the source **mtime + size**, so replacing a file invalidates its derivatives automatically — never add cache-busting query strings.
- Derivatives **never upscale**: requesting 1920w from a 1200w original returns 1200w.
- ICC profiles are retained. Stripping them makes Adobe RGB garment photos render washed-out.
- Request path uses the **fast** encoder preset (~1–2s worst case) and queues the high-compression re-encode in the background. Never make a visitor wait on `effort: 4` AVIF — it measured **5.1s** at 1920w.
- Background encodes are serialised (`IMAGE_BACKGROUND_CONCURRENCY`, default 1). A 10-image upload would otherwise fan out to ~70 concurrent AVIF encodes and starve the event loop.
- `/img` is mounted **before** the `/uploads` static handler and must stay that way.

**Measured** (photographic 2400×3000 source, 1.4 MB): 828w AVIF ≈ **10 KB**, 1920w AVIF ≈ **45 KB** vs 548 KB for the equivalent WebP. AVIF is ~12× smaller than WebP at large widths, which is why it is primary.

### Frontend components

| Component | Role |
|---|---|
| `Navbar` (552 L) | Header, mega-menu, gender toggle, search, cart badge, account menu |
| `Footer` | Settings-driven links + social |
| `MobileBottomNav` | Mobile tab bar (pages must add bottom padding) |
| `CartDrawer` | Global slide-out cart, driven by `cartSlice.isOpen` |
| `ProductCard` (251 L) | Canonical product tile — **reuse; do not fork** |
| `ProductDetailClient` (364 L) | Gallery, variant picker, add-to-cart, FAQs, reviews |
| `GenderHomePage` | Assembles homepage sections by `HomepageSectionType` |
| `HeroSlider`, `ProductSection`, `CategoryShowcase`, `TestimonialsSection` | Homepage blocks |
| `CategoryPageClient`, `CollectionPageClient` | Filter/sort/paginate listings |
| `AdminLayoutClient` (314 L) | Admin shell: sidebar, nav search, role badge, logout |
| `AccountSidebar` | Account nav |
| `AuthInitializer` | Rehydrates user + cart on mount |
| `GenderInitializer` | Restores `ud_gender` from localStorage |
| `ErrorFallback` | Shared error UI for `error.tsx` boundaries |

### Frontend hooks

- `useAuth()` → `{ user, isAuthenticated, isLoading, isAdmin, isSubAdmin, login, register, logout }` — handles toasts and redirects.
- `useCart()` → `{ cart, itemCount, subtotal, isLoading, isOpen, fetchCart, addToCart, updateQuantity, removeFromCart, clearCart }` — refetches after every mutation and opens the drawer on add.

---

## 20. Error Handling & Logging

### Backend

```ts
// expected failure — anywhere in a service or controller
throw new AppError('Insufficient stock for "Classic Tee"', 400);
```

`express-async-errors` routes async throws to `errorHandler`, which logs `METHOD PATH - STATUS - MESSAGE` plus `stack`, `body`, and `params`, then responds with the standard error envelope (`stack` included only in dev).

> ⚠ The handler logs `req.body`, so **failed login/register requests write the submitted password into `logs/error.log`**. Redact before logging in any new code, and treat these logs as sensitive (§25).

### Backend logging

Winston, level `debug` in dev / `info` in prod. Transports: colourised console; `logs/error.log` (error only); `logs/combined.log`. Both files rotate at **5 MB × 5**. Morgan pipes HTTP logs into `logger.http` **in development only**. **Never use `console.log`** — use `logger`.

### Frontend

Handled centrally in `lib/axios.ts`:

| Status | Behaviour |
|---|---|
| 401 | Single-flight refresh + replay; on failure clear storage → `/login` |
| 429 | Toast with `Retry-After` |
| ≥500 | Toast with server message or generic fallback |
| no response | `ECONNABORTED` → "Request timed out"; else "Cannot reach the server" |
| 400/403/404 | **Passed through** — the calling component must `catch` and toast |

Toasts are de-duplicated by message for 5 s. Route-level `error.tsx` boundaries exist at root, `(store)`, and `(admin)`.

> Two stray `console.log("🚀 ~ API_URL:", API_URL)` calls (`constants/index.ts:5`, `lib/axios.ts:4`) ship to production and print the backend IP. Remove them (§25).

---

## 21. Security Practices

### In place

| Control | Implementation |
|---|---|
| Password hashing | bcrypt, 12 rounds |
| Token separation | Distinct secrets for access vs refresh |
| Refresh rotation | New refresh token on every use; stored server-side and compared |
| Live authorisation | `authenticate` re-reads the user each request; uses `dbRole` |
| Deactivation | `isActive: false` → immediate 401 on the next request |
| Ownership checks | Orders and payments verify `userId` before acting |
| Headers | `helmet` (backend) + `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (frontend `next.config.ts`) |
| CORS | Explicit allow-list, credentials enabled |
| Rate limiting | Global + strict auth limiter (production) |
| Input validation | Joi with `stripUnknown: true` |
| XSS | `xss-clean` middleware |
| SQL injection | Prisma parameterises everything, including the tagged-template `$queryRaw` in analytics |
| Upload safety | MIME allow-list, size caps, UUID filenames (no user-controlled paths) |
| Razorpay | HMAC-SHA256 signature verification |
| Cashfree webhook | HMAC-SHA256 over `timestamp + rawBody`, compared with `crypto.timingSafeEqual`; terminal-state guard + atomic `updateMany` for idempotency; always ACKs 200 to avoid retry storms |
| Secrets | Never committed; `.gitignore` covers `.env*` except `*.example` |
| Prod env guard | Startup fails fast on missing JWT/DB secrets |
| SEO hygiene | `robots.ts` disallows `/admin /account /checkout /cart /api` |

### Rules for new code

1. **Never trust client-supplied prices, totals, discounts, or role fields.** Re-derive from the DB. (The current order flow violates this — see §25 #1.)
2. Every user-owned resource needs an ownership check, not just a role check.
3. Never log credentials, tokens, or full request bodies containing them.
4. Never put a secret behind `NEXT_PUBLIC_`.
5. Payment state transitions must be idempotent and guarded against concurrent writes — follow the Cashfree webhook pattern.
6. Validate every user-writable payload with Joi before it reaches a service.

---

## 22. Deployment & Server Configuration

### Topology

```
Internet
   │  443 (TLS)
┌──▼─────────────────────────────────────────┐
│ Nginx  — TLS termination, reverse proxy    │
│   /            → localhost:3000  (Next.js) │
│   /api/v1/     → localhost:5000  (Express) │
│   /uploads/    → localhost:5000  (static)  │
└──┬──────────────────────────┬──────────────┘
   │                          │
Next.js :3000            Express :5000  (PM2 cluster, instances: max)
                              │
                          MySQL :3306
                              │
                       ./uploads (persistent volume)
```

`app.set('trust proxy', 1)` is required for correct client IPs / rate limiting behind Nginx.

### Backend deploy (PM2)

```bash
cd backend
git pull
npm ci
npm run prisma:generate
npm run prisma:push          # ⚠ back up the DB first — see §13
npm run build
pm2 restart luxestore-api    # or: pm2 start ecosystem.config.js
pm2 save
```

PM2: cluster mode, `instances: 'max'`, `max_memory_restart: 512M`, `restart_delay: 3000`, `max_restarts: 10`, logs to `logs/pm2-*.log`.

### Frontend deploy

```bash
cd frontend
git pull
npm ci
npm run build
pm2 restart ud-client        # or: npm start
```

`NEXT_PUBLIC_*` values are baked in at build time — **a config change requires a rebuild, not just a restart.**

### Docker

Both apps have multi-stage Dockerfiles on `node:20-alpine` with `dumb-init` as PID 1 and a non-root user.

- **Backend:** builds to `dist/`, pre-creates the `uploads/*` folders, runs as `node`, exposes 5000. Mount `uploads/` and `logs/` as volumes or uploads are lost on redeploy.
- **Frontend:** expects `.next/standalone`, which only exists when built with `NEXT_OUTPUT=standalone` (see §25 #8).

### Server checklist (per the Server Rules)

- [ ] `.env` present, permissions `600`, real secrets (no fallbacks)
- [ ] Ports 3000/5000 bound to localhost only; firewall exposes 80/443 only
- [ ] Nginx TLS valid + auto-renewing; HTTP→HTTPS redirect
- [ ] `client_max_body_size` ≥ 10 MB (matches the Express body limit)
- [ ] `FRONTEND_URL` / `ADMIN_URL` set to real origins (CORS)
- [ ] `RATE_LIMIT_*` tuned; `NODE_ENV=production` (rate limiting is off otherwise)
- [ ] MySQL reachable, credentials scoped, **automated `mysqldump` in place**
- [ ] `uploads/` on persistent storage and backed up
- [ ] `logs/` rotation confirmed (5 MB × 5) and disk monitored
- [ ] `GET /health` wired to uptime monitoring
- [ ] PM2 `startup` + `save` configured for reboot survival
- [ ] Cashfree/Razorpay keys set for the correct environment
- [ ] Webhook URL (`${BASE_URL}/api/v1/payments/cashfree/webhook`) publicly reachable

---

## 23. Testing Strategy & QA Checklist

### Current state

**There are no automated tests in either repository** — no test runner, no test files, no CI. All verification is manual. Treat this as the primary quality risk on the project.

### Target strategy

| Level | Tool | Priority scope |
|---|---|---|
| Unit (BE) | Jest + ts-jest | `OrderService.createOrder` (pricing, stock, coupons), `AuthService`, `paginationParams`, `createSlug` |
| Integration (BE) | Supertest + test MySQL | Auth flow, order lifecycle, payment verification, role guards |
| Component (FE) | Vitest + Testing Library | `ProductCard`, `CartDrawer`, checkout form validation |
| E2E | Playwright | Browse → cart → checkout → COD order; admin product CRUD |

### QA checklist — every feature must pass before sign-off

**Functional**
- [ ] Happy path end-to-end
- [ ] Negative paths: invalid input, missing required fields, wrong types
- [ ] Boundaries: qty 0 / 1 / max, price 0, empty cart, empty lists, `limit=1` and `limit=100`, page beyond last
- [ ] Server-side validation rejects what the UI blocks (test with curl/Postman, bypassing the form)

**Auth & authorization**
- [ ] Unauthenticated → 401; wrong role → 403
- [ ] Customer cannot read/modify another customer's order, address, or cart (change the ID in the URL)
- [ ] Expired access token silently refreshes; expired refresh token redirects to login
- [ ] Deactivated user is rejected on the next request

**Data integrity**
- [ ] Stock decrements exactly once per order
- [ ] Order totals in the DB match what the customer was shown at checkout
- [ ] Coupon usage count increments correctly; limits enforced
- [ ] Order snapshots stay frozen after the product is edited

**Payments**
- [ ] COD order confirms without a gateway call
- [ ] Razorpay: success, cancelled modal, tampered signature (must 400)
- [ ] Cashfree: success, expiry, duplicate webhook (must be a no-op), missed webhook recovered by status polling

**UI/UX**
- [ ] Loading skeleton, error state, and empty state all present
- [ ] Mobile (360px), tablet (768px), desktop (1440px)
- [ ] Bottom nav does not overlap page content on mobile
- [ ] Keyboard navigable; images have alt text; interactive elements have accessible names
- [ ] Chrome, Firefox, Safari (incl. iOS)

**Regression**
- [ ] Homepage renders with all section types
- [ ] Cart survives login (guest → authenticated)
- [ ] Gender toggle filters products, banners, and categories consistently
- [ ] Admin list pages paginate, filter, and sort
- [ ] `sitemap.xml` and `robots.txt` still resolve

**No task is complete without explicit QA sign-off.**

---

## 24. CI/CD

**None configured.** No `.github/workflows`, no pipeline files, no automated build/test/deploy. Deployment is manual (§22).

Recommended first pipeline (per app, on PR to `main`):

```
checkout → npm ci → prisma generate (BE) → type-check → lint → build → [tests] → deploy on merge
```

---

## 25. Known Issues

Verified against the code on 2026-07-27. Ordered by severity.

### 🔴 Critical

**1. Order totals are computed from client-supplied prices.**
`OrderService.createOrder` (`order.service.ts:46`) computes `subtotal` from `data.items[].price` — a value sent by the browser. A crafted request can create an order for any amount. Product prices exist in `productMap` already and must be used instead.

**2. Frontend and backend disagree on shipping charges.**
Frontend checkout (`checkout/page.tsx:46`) uses `FREE_SHIPPING_THRESHOLD = 999` / `SHIPPING_CHARGE = 99`. Backend uses `STANDARD 79 / COD 149 / EXPRESS 249` with **no** free-shipping rule (`order.service.ts:7-11`), and prefers a per-product override when set. **The customer is shown one total and charged another.** Shipping must be computed server-side and returned to the UI.

**3. Stock is not restored when an order is cancelled.**
`createOrder` decrements `stockQuantity` and increments `totalSold`; `cancelOrder` only flips the status. Cancelled orders permanently leak inventory and inflate `totalSold`.

### 🟠 High

**4. Coupon usage is consumed before payment succeeds.**
`usageCount` increments inside order creation. Abandoned or failed payments burn coupon capacity. `Coupon.userLimit` is defined in the schema but **never enforced** — a single user can reuse a coupon indefinitely.

**~~5b. Images were served unoptimized.~~ FIXED 2026-07-27.** Product/category/blog/collection/avatar/media uploads were stored raw and served byte-for-byte to every visitor (only banners and stores were optimized), and `next/image` could not optimize them either because `remotePatterns` rejected the API's `http` bare-IP host. Replaced with the derivative pipeline documented in §19. Four `<Image fill>` usages were also missing `sizes`, so 64–100px thumbnails were downloading full-viewport-width images.

**5. `API_URL` is hardcoded, and it logs itself.**
`constants/index.ts:3` sets `API_URL = "http://109.123.239.204:5000/api/v1"`, ignoring `NEXT_PUBLIC_API_URL` entirely. Line 5 and `lib/axios.ts:4` then `console.log` it to the browser console in production. Environment promotion currently requires a code edit.

**6. Failed logins write plaintext passwords to disk.**
`errorHandler` logs `req.body` on every error, so a failed `/auth/login` or `/auth/register` persists the submitted password into `logs/error.log`.

**7. CMS pages are broken.**
`app/(store)/[page]/page.tsx:11` fetches `${API_URL}/cms/${slug}`, but the backend serves CMS content at `/api/v1/seo/cms/:slug`. There is no `/cms` mount in `app.ts` — every CMS page (about, privacy-policy, terms, return-policy, shipping-policy, faq) 404s. These slugs are also listed in `sitemap.ts`.

**8. The frontend Docker image cannot build as written.**
The Dockerfile copies `.next/standalone`, but `next.config.ts` only emits standalone output when `NEXT_OUTPUT === 'standalone'`, which the Dockerfile never sets.

### 🟡 Medium

**~~9. Next.js 15.0.3 carries a known vulnerability.~~ NOT AN ISSUE — corrected 2026-08-05.** This was recorded from the stale `ud-client` repo, which is **not** what production runs. The deployed `ud-c` app is on **Next 15.5.19** (verified from `node_modules/next/package.json` on the server), so the **CVE-2025-66478** patch is applied. Only the retired `ud-client` snapshot still pins 15.0.3.

**10. Cashfree is half-wired.** The backend implements order creation, COD deposits, status polling, and a hardened webhook. The frontend has **zero** Cashfree code — `paymentApi` exposes only Razorpay, and checkout offers only COD and Razorpay. Additionally, `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` are **absent from the current backend `.env`**, so `getCashfree()` would throw "Cashfree keys not configured".

**11. No ESLint configuration exists in either project**, yet both define a `lint` script. `npm run lint` fails in both. No formatter (Prettier) either — style is convention-only.

**12. No migration history.** `prisma/migrations/` is empty; the schema is applied with `db push`. No rollback path, no audit trail, and a real risk of destructive column drops on production.

**13. `SubAdmin.permissions` is dead weight.** The Json column exists but nothing reads it. `SUB_ADMIN` is effectively a fixed role via `isAdminOrSubAdmin`.

**14. Password reset cannot complete.** `forgotPassword` returns the reset token in the API response instead of emailing it. SMTP is configured; no mailer module exists.

**15. Guest carts are addressable by header alone.** `x-session-id` is a client-supplied UUID with no signature. Knowing a session ID grants full read/write on that cart. Low practical risk (v4 UUID), but it is not authenticated.

**16. Admin routes are protected client-side only.** No `middleware.ts`; `AdminLayoutClient` redirects in a `useEffect`, so admin chrome flashes before redirecting. Server-side guards are correct, so this is a UX/disclosure issue rather than an auth bypass.

### 🟢 Low

17. `xss-clean` is unmaintained and archived; `csurf` is deprecated and imported nowhere. Both should go.
18. Declared-but-unused dependencies: `express-validator`, `@tanstack/react-table`, `zustand`, `next-themes`. Two carousel libraries (`swiper` + `react-slick`) and two toast libraries (`react-hot-toast` + `notistack`) coexist.
19. `frontend/.env` declares `BACKEND_URL` and `NEXT_PUBLIC_API_URL` **twice** each; the last value silently wins.
20. Uploaded files are never deleted when a product is soft-deleted — `uploads/` grows without bound.
21. `PaymentMethod` enum includes `UPI`, `CARD`, `NET_BANKING`, which no code path sets. `ReturnRequest` and `Notification` models have no endpoints. `InventoryLog` is written nowhere despite `createOrder` changing stock.
22. `src/jobs/`, `src/validators/`, and `docs/` are empty directories.
23. Naming drift: PM2 app is `luxestore-api`; Razorpay checkout displays "LUXÉ Fashion"; the product JSON-LD falls back to brand "LUXÉ"; `AdminLayoutClient:175` renders a hardcoded, misspelled "Unique Dreessup".
24. `Store` model lacks an `@@map`, so its table is `Store` while every other table is snake_case plural.
25. `generateOrderNumber()` uses `Math.random()` with no uniqueness retry; `orderNumber` is `@unique`, so a collision surfaces as a 500.

---

## 26. Future Improvements

**Correctness first** (fix §25 #1–#8 before anything below.)

| Priority | Improvement |
|---|---|
| P0 | Server-authoritative pricing: compute subtotal, shipping, tax, and discount from the DB; return a quote the UI displays |
| P0 | Restore stock and reverse `totalSold` on cancel/return; write `InventoryLog` rows for every stock movement |
| P0 | Move coupon consumption to payment success; enforce `userLimit` |
| P1 | Adopt `prisma migrate` and back-fill an initial migration |
| P1 | Add ESLint + Prettier configs; wire `type-check`, `lint`, `build` into CI |
| P1 | Introduce Jest/Supertest for order, auth, and payment paths |
| P1 | Drive `API_URL` from `NEXT_PUBLIC_API_URL`; delete the stray `console.log`s |
| P1 | Implement the mailer (order confirmations, password reset, shipping updates) |
| P2 | Finish Cashfree on the frontend, or remove the backend surface |
| P2 | Add Next.js `middleware.ts` for admin route protection |
| P2 | Redact sensitive fields before logging request bodies |
| P2 | Replace `xss-clean`/`csurf`; prune unused dependencies; consolidate carousel and toast libraries |
| P2 | Enforce `SubAdmin.permissions`, or drop the model |
| P3 | Redis caching for homepage/product listings; move uploads to S3/CDN |
| P3 | Wire up `ReturnRequest` and `Notification` endpoints |
| P3 | React Query for all client-side reads (it is already installed) |
| P3 | Sentry or equivalent for error tracking; structured request IDs in logs |

---

## 27. Coding Rules

### Backend

1. Validate every user-writable input with Joi before it reaches a service.
2. Handle errors explicitly — throw `AppError`, never swallow silently.
3. Follow **SOLID / DRY / KISS**: one responsibility per module, extract shared logic to `utils/`, prefer the simple solution.
4. Optimise queries: `select`/`include` only what you need, use `Promise.all` for independent queries, paginate every list, add an index before shipping a new filterable field.
5. Secure every endpoint: correct guard **plus** an ownership check where relevant.
6. Never hardcode a secret, key, URL, or price.
7. Wrap multi-write invariants in `prisma.$transaction`.
8. Comment the *why* for non-obvious decisions.

### Frontend

1. Build reusable components; never fork `ProductCard` — extend it.
2. Every layout must work at 360 / 768 / 1440 px.
3. Accessibility: semantic elements, `alt` text, labels, visible focus, keyboard paths.
4. Performance: `next/image`, dynamic imports for heavy client components, no client-side fetch for data a Server Component can fetch.
5. Always render loading, error, and empty states.
6. Skeletons for content-shaped loads; spinners only for button-level actions.
7. Validate forms with Formik + Yup, and never rely on that as the only validation.
8. Use theme tokens — no ad-hoc hex colours.

---

## 28. Do's and Don'ts

### ✅ Do

- Read this file before changing code, and inspect the actual source before concluding anything.
- Use `sendSuccess` / `sendError` / `sendPaginated` for every response.
- Use `.bind(controller)` when wiring routes.
- Include `deletedAt: null` in every public query.
- Re-derive money server-side from the database.
- Put every API call in `services/api.service.ts`.
- Run `npm run type-check` (FE) and `npm run build` (BE) before declaring work done.
- Back up the database before `prisma db push`.
- Document assumptions explicitly when information is missing.
- Keep changes minimal and backwards-compatible.

### ❌ Don't

- Don't `console.log` in backend code — use `logger`.
- Don't trust client-supplied prices, totals, discounts, roles, or user IDs.
- Don't return a bare object or array — always use the envelope.
- Don't add a new state, form, toast, or carousel library.
- Don't put secrets behind `NEXT_PUBLIC_`.
- Don't skip the ownership check because a role guard is already present.
- Don't mutate `OrderItem` snapshots or order addresses after creation.
- Don't remove the `verify` hook on `express.json` (breaks the Cashfree webhook) or the `BigInt.toJSON` patch (breaks analytics).
- Don't place `/:id` routes before static sibling routes like `/reorder`.
- Don't rewrite working architecture without a stated, compelling reason.
- Don't mark a task complete without QA sign-off.

---

## 29. Development Workflow

### Team roles

Engineering Manager (approval, risk) → Technical Team Lead (breakdown, review) → Backend System Engineer (impact, architecture, security) → Backend Engineer (implementation) → Frontend Engineer (integration) → Server/DevOps Engineer (deploy, infra) → Manual QA Engineer (verification).

### Feature request — respond in this order

1. Requirement understanding
2. Engineering Manager decision
3. Team Lead task breakdown
4. Backend system analysis (impact + affected modules)
5. Backend implementation plan
6. Frontend implementation plan
7. QA test plan
8. Risks
9. Estimated impact
10. Begin implementation

### Feature pipeline

```
EM approve → TL breakdown → BSE impact analysis → BE implement → BSE review
→ FE integrate → TL review integration → QA test → (bugs → back to owner → retest)
→ EM approve → done
```

### Bug pipeline

```
Understand → Reproduce → Root cause analysis → Identify affected modules
→ Backend fix → Review → Frontend fix → Review → QA verify → Regression → Close
```

Never skip a stage. Never start coding before the analysis stages are written down.

### Git branch strategy

| Branch | Purpose |
|---|---|
| `main` | Production. Both repos currently commit directly to `main` — prefer PRs going forward. |
| `feature/<slug>` | New functionality |
| `fix/<slug>` | Bug fixes |
| `hotfix/<slug>` | Urgent production patches |
| `chore/<slug>` | Deps, config, tooling |

Commit style is inconsistent today (many bare `updated` messages). **Use Conventional Commits going forward:** `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `perf:`, `test:` — e.g. `feat: add gender toggle feature — MEN/WOMEN/UNISEX per product` (an existing good example).

Backend and frontend are **separate repos**. A cross-cutting change needs two coordinated PRs; call out the dependency, and ship the backend first so the frontend never calls a route that doesn't exist yet.

### Code review checklist

**Correctness** — requirement met · edge cases · errors handled · no regression
**Security** — authn/authz correct · ownership verified · input validated · no trusted client values · no secrets · no sensitive logging
**Performance** — no N+1 · indexed filters · paginated · no oversized payloads · client bundle impact
**Maintainability** — matches conventions · no duplication · sensible naming · comments explain why · types accurate (no gratuitous `any`)
**Data** — transactions where required · counters consistent · snapshots preserved · migration reviewed
**Frontend** — responsive · accessible · loading/error/empty states · theme tokens · reuses existing components
**Testing** — QA cases listed and executed

---

## 30. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                      │
│        Desktop browser    ·    Mobile browser    ·    Admin user           │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ HTTPS
┌───────────────────────────────▼──────────────────────────────────────────┐
│                        NGINX (TLS, reverse proxy)                         │
└──────────┬──────────────────────────────────────┬────────────────────────┘
           │ /                                    │ /api/v1  ·  /uploads
┌──────────▼──────────────────────────┐ ┌─────────▼────────────────────────┐
│   NEXT.JS 15 · React 19 · :3000     │ │  EXPRESS 4 · TypeScript · :5000  │
│                                      │ │                                  │
│  app/(store)   storefront  SSR/CSR   │ │  helmet → cors → rateLimit →     │
│  app/(admin)   admin panel  CSR      │ │  json(+rawBody) → xss → gzip     │
│  app/(account) account      CSR      │ │            ↓                     │
│  app/(auth)    login/register        │ │  routes → authenticate →         │
│                                      │ │  authorize → validate → multer   │
│  ── state ──────────────────────     │ │            ↓                     │
│  Redux: auth · cart · gender         │ │  controllers → services          │
│  React Query · MUI theme             │ │            ↓                     │
│                                      │ │  Prisma Client (singleton)       │
│  services/api.service.ts ── axios ───┼─┼──→ /api/v1/*                     │
│  lib/axios.ts (refresh queue)        │ │            ↓                     │
│  RSC fetch (BACKEND_URL) ────────────┼─┼──→ SSR data                      │
└──────────────────────────────────────┘ └─────────┬────────────────────────┘
                                                    │
                        ┌───────────────────────────┼────────────────┐
                        │                           │                │
                 ┌──────▼──────┐          ┌─────────▼───────┐  ┌─────▼──────┐
                 │  MySQL 8    │          │  ./uploads      │  │  External  │
                 │  34 models  │          │  products/      │  │  Razorpay  │
                 │  Prisma ORM │          │  banners/ ...   │  │  Cashfree  │
                 └─────────────┘          └─────────────────┘  │  Google    │
                                                                │  SMTP*     │
                                                                └────────────┘
                                                                * configured,
                                                                  not implemented
```

---

## 31. Data Flow

### Guest browsing → cart → registered checkout

```
1. Visitor lands on /
   └─ Server Component fetches, in parallel:
      /homepage/data · /products/{featured,new-arrivals,trending,best-sellers} · /categories/featured
   └─ (store)/layout.tsx fetches /settings/public → Navbar + Footer

2. Visitor opens /product/awesome-tee
   └─ SSR fetch /products/awesome-tee (revalidate 120) → viewCount++
   └─ JSON-LD Product schema injected for SEO

3. Visitor adds to cart (client)
   └─ axios attaches x-session-id (localStorage UUID)
   └─ POST /cart/add → getOrCreateCart({ sessionId }) → CartItem row
   └─ useCart refetches → cartSlice.setCart → badge + drawer open

4. Visitor registers / logs in
   └─ POST /auth/login → tokens → localStorage + authSlice
   └─ AuthInitializer → GET /auth/me → rehydrate → fetchCart

5. Checkout
   └─ GET /users/addresses → prefill; Formik/Yup validate
   └─ POST /orders → TRANSACTION:
        stock check → totals → coupon apply (+usageCount) → Order + OrderItems
        → decrement stock, increment totalSold
   └─ COD  → clearCart → /order-success
      ONLINE → POST /payments/razorpay/create → Razorpay modal
             → handler → POST /payments/razorpay/verify (HMAC)
             → Payment.status PAID, Order CONFIRMED/PAID → clearCart → /order-success
```

### Admin product publish

```
Admin → /admin/products/add
  → FormData (fields + up to 10 images + variants JSON)
  → POST /products  [authenticate → isAdminOrSubAdmin → multer]
  → controller parses FormData, coerces booleans/numbers, parses variants JSON
  → productService.createProduct → slug (deduped with a timestamp suffix)
      → Product + ProductImage[] + ProductVariant[] + ProductTag[] + ProductCollection[]
  → 201
  → Storefront picks it up on the next revalidation (homepage no-store, PDP 120s)
```

### Gender toggle

```
Navbar toggle → genderSlice.setGender → localStorage 'ud_gender'
  → product queries send ?gender=MEN
  → backend filters { gender: { in: ['MEN', 'UNISEX'] } }
  → banners filter on Banner.gender ∈ {MEN, ALL}
On next load, GenderInitializer restores the saved value.

Reels follow the same path: `/` fetches `/instagram-reels?gender=` from the cookie at SSR time, and
`GenderHomePage` refetches them alongside the banners when the toggle moves — reels live in
component state, not in `initialData`, or they would stay on whatever the server first rendered.
```

---

## 32. API Flow

### Anatomy of an authenticated admin write

```
PUT /api/v1/products/:id      Authorization: Bearer <access>
   │
   ├─ helmet · cors(allow-list) · rateLimit(prod) · json · xss · compression
   ├─ authenticate     verify JWT → load user (isActive, !deleted) → req.user.dbRole
   ├─ isAdminOrSubAdmin  dbRole ∈ {ADMIN, SUPER_ADMIN, SUB_ADMIN} else 403
   ├─ multer.array('images', 10)   → disk, uuid filenames, MIME + size checked
   ├─ productController.updateProduct
   │     coerce FormData booleans/numbers → productService.updateProduct
   │        exists? (404) → remove images → replace tags → update → normalise primary image
   └─ sendSuccess(res, product, 'Product updated')

on throw → errorHandler → log(method, path, status, message, stack, body, params)
         → { success: false, message, stack? }
```

### Token refresh (single-flight)

```
Any request → 401
  ├─ refresh already in flight? → queue and replay after it resolves
  └─ else: POST /auth/refresh { refreshToken }
        ├─ 200 → store new pair → replay queued + original requests
        └─ fail → clear storage → window.location = '/login'
```

### Cashfree payment (backend-complete, frontend pending)

```
POST /payments/cashfree/create → PGCreateOrder → payment_session_id (30-min expiry)
        ↓                                     ↘ notify_url = BASE_URL/api/v1/payments/cashfree/webhook
   [customer pays]
        ↓
Cashfree → POST /payments/cashfree/webhook
   1. HMAC-SHA256(timestamp + rawBody) vs x-webhook-signature (timingSafeEqual) → 401 on mismatch
   2. lookup Payment by cashfreeOrderId; if already PAID/FAILED → ACK, no-op
   3. PGFetchOrder → canonical status (never trust the payload)
   4. updateMany(where status != PAID) → only the first concurrent caller wins
   5. winner updates the Order (full payment → PAID/CONFIRMED; COD deposit → deliveryChargePaid)
   6. ALWAYS respond 200 — prevents retry storms
        ↓
Frontend fallback: GET /payments/cashfree/status/:orderId after the modal closes
                   → re-fetches and self-heals a missed webhook
```

---

## 33. Dependency Graph

### Backend module dependencies

```
server.ts
  └─ app.ts
       ├─ config/env ──────────────── (leaf; read by nearly everything)
       ├─ utils/logger ─────────────→ config/env
       ├─ middlewares/error ────────→ utils/logger, config/env
       ├─ middlewares/auth ─────────→ utils/jwt, utils/response, config/prisma
       ├─ middlewares/validate ─────→ utils/response  (Joi)
       └─ modules/*/routes
            └─ modules/*/controllers
                 ├─ modules/*/services ──→ config/prisma, utils/*, middlewares/error
                 ├─ config/prisma ───────→ config/env
                 └─ utils/{response, upload, slugify}

Rules:  utils/ imports nothing from modules/ · modules never import each other
        config/prisma is a singleton — never construct a second PrismaClient
```

### Frontend dependency layers

```
app/**/page.tsx  (Server)  ──→ constants (API_URL) ──→ native fetch ──→ backend
app/**/page.tsx  (Client)  ──→ components/**  ──→ hooks/**  ──→ services/api.service
                                                          └──→ store/slices
                                    services/api.service ──→ lib/axios ──→ constants
                                    components/** ──→ utils/format, types, themes
                                    providers/** wraps everything at app/layout.tsx

Rules:  components never call axios directly — always services/api.service
        types/index.ts is the single shared contract with the API
        utils/ and constants/ are leaves
```

### External integration points

| Integration | Backend touchpoint | Frontend touchpoint |
|---|---|---|
| Razorpay | `payment.controller` (SDK + HMAC) | `checkout/page.tsx` (`checkout.razorpay.com` script) |
| Cashfree | `payment.controller` (SDK + webhook) | **none yet** |
| Google OAuth | `auth.service.googleLogin` | login/register pages |
| MySQL | Prisma singleton | — |
| Filesystem | `utils/upload`, `/uploads` static | `next/image` remote patterns |
| SMTP | configured, unused | — |

---

## 34. Business Modules

| Module | Owns | Key rules |
|---|---|---|
| **Auth** | Register, login, Google OAuth, refresh, logout, password reset/change | Refresh rotation; single active session; `isVerified` auto-true in dev |
| **Users** | Profile, addresses, notifications, recently-viewed; admin user management | One default address per user; admin can toggle `isActive` |
| **Products** | Catalog, variants, images (optionally per-colour), tags, badges, FAQs, related products | Soft delete; slug deduped with a timestamp; exactly one primary image is enforced on update; `viewCount` increments on public detail fetch |
| **Categories** | Self-referencing tree, nav menu, featured/home flags | `showInNav` / `showOnHome` / `isFeatured` drive storefront placement; optional gender |
| **Collections** | Curated groupings via `ProductCollection` | Many-to-many with `sortOrder` |
| **Cart** | Guest + authenticated carts, coupon preview | Guest via `x-session-id`, user via `userId`; qty < 1 deletes the line; price snapshotted at add time |
| **Wishlist** | Saved products | Unique `[userId, productId]`; authenticated only |
| **Orders** | Creation, listing, tracking, status transitions, cancellation | Fully transactional; validates stock before writing; snapshots item + address data; cancel only from `PENDING`/`CONFIRMED` |
| **Payments** | Razorpay, Cashfree, COD deposits, webhook | Signature verification mandatory; idempotent terminal states; ownership checked on every endpoint |
| **Coupons** | Validation and application | Types: `PERCENTAGE`, `FIXED`, `FREE_SHIPPING`, `BUY_X_GET_Y` (last two are not implemented in the discount math); `minOrderAmount`, `maxDiscount`, `usageLimit` honoured; `userLimit` **not** enforced |
| **Reviews** | Customer reviews + moderation | `PENDING` → `APPROVED`/`REJECTED`; only approved reviews are public |
| **Homepage** | Section builder | 24 `HomepageSectionType` variants; `sortOrder` + `isActive`; `config` is free-form Json (e.g. `{ limit: 8 }`) |
| **Banners** | Hero / promotional / category creatives | Typed + gender-scoped + date-windowed; image cap = `MAX_FILE_SIZE` (was 1 MB; the route now follows the shared limit) |
| **Blogs** | Posts, categories, tags | Soft delete; `isPublished` + `publishedAt` gate visibility |
| **SEO & CMS** | Per-page meta, CMS pages | `SeoMeta` keyed by page name; `CmsPage` rendered by the `[page]` catch-all (**currently broken — §25 #7**) |
| **Settings** | Key/value config by group | Groups: general, contact, social, homepage, shipping; `/settings/public` is the storefront-safe subset |
| **Media** | Central library | Folder enum; batch upload up to 20 files |
| **Stores** | Physical store locator | 2 MB image cap; reorderable |
| **Nav Menus** | Editable navigation links | Uses the previously-unused `NavMenu` model. `position` names the surface (`quick_links` = the row atop the Shop mega menu); `gender` follows the banner vocabulary. URLs must be site paths — these render as anchors in the site chrome, so an absolute URL would turn the shop's own menu into an offsite redirect. **The storefront keeps its own four defaults and uses them whenever the table is empty**, applied *before* the gender filter so MEN-only links do not silently reinstate the defaults for women |
| **Instagram Reels** | Self-hosted reel videos | Reorderable; sub-admin manageable; gender-targeted (`ALL`/`WOMEN`/`MEN`) like banners. The storefront asks for a gender and gets that gender **plus** `ALL`; the admin filter is an exact match, because someone reviewing the Men reels wants the rows tagged `MEN`, not every row a man happens to see. An unrecognised value degrades to `ALL` rather than 400-ing, so a bad payload can never hide a reel from every shopper |
| **Analytics** | Admin dashboard + revenue report | Revenue counts `paymentStatus: PAID` only; uses `$queryRaw` with `BigInt` serialisation |

---

## 35. Glossary

| Term | Meaning |
|---|---|
| **Access token** | Short-lived JWT (`JWT_EXPIRE`, default 1d) sent as `Authorization: Bearer` |
| **Refresh token** | Long-lived JWT (default 30d) stored on `User.refreshToken`; rotated on every use |
| **`dbRole`** | The role read fresh from the database by `authenticate`; the **only** value authorization trusts |
| **Envelope** | The `{ success, message, data, meta? }` response shape produced by `utils/response.ts` |
| **Soft delete** | Setting `deletedAt` (and usually `isActive: false`) instead of removing the row |
| **Snapshot** | Order-time copies of product and address data on `OrderItem` / `Order`, frozen against later edits |
| **`x-session-id`** | Client-generated UUID identifying a guest cart |
| **Variant** | A specific size/colour/material SKU of a product, with its own price and stock |
| **Gender toggle** | Storefront MEN/WOMEN filter; matches products tagged with the selection **or** `UNISEX` |
| **Homepage section** | An admin-configured, ordered content block on the homepage (one of 24 types) |
| **COD deposit** | Cashfree flow collecting only the delivery charge online; the product amount is paid in cash on delivery |
| **`payment_session_id`** | Cashfree token the frontend uses to open the checkout modal |
| **Idempotent webhook** | A webhook safe to deliver repeatedly — guarded here by terminal-state checks and atomic `updateMany` |
| **`db push`** | `prisma db push` — applies the schema directly, with no migration file and no rollback |
| **RSC** | React Server Component — renders on the server, ships no JS |
| **Route group** | `(name)` folder in the App Router; scopes layouts without appearing in the URL |
| **Single-flight refresh** | One in-flight token refresh; concurrent 401s queue and replay |
| **`AppError`** | Backend error class carrying an HTTP status; the standard way to signal expected failures |

---

## Working Agreement

**Every task starts by reading this file.**

1. Requirement analysis → 2. Impact analysis → 3. Architecture review → 4. Implementation plan → 5. Risk analysis → 6. Backend changes → 7. Backend review → 8. Frontend changes → 9. Frontend review → 10. QA test cases → 11. Testing → 12. Fixes → 13. Completion.

Never guess — inspect the code. Explain *why* before implementing. Preserve the existing architecture unless there is a compelling, stated reason to change it. Prefer minimal, maintainable changes. Document assumptions. Maintain backwards compatibility. **Treat this as a production system with real users.**

*Keep this document current: update it whenever you add a module, change the schema, alter an API contract, or resolve anything listed in §25.*
