# E-Commerce Backend — Iterative Feature Development Scenarios

## Overview

Build an e-commerce backend in Java/Spring/JPA with Flyway migrations, iterating through features using the Lakebase SCM workflow. Each scenario simulates what a developer does day-to-day: create a branch, write code + migration, commit, push, open a PR, get it merged, and verify production.

## Architecture

```
src/main/java/com/example/demo/
├── DemoApplication.java
├── model/          # JPA entities
├── repository/     # Spring Data JPA repositories
├── service/        # Business logic
└── controller/     # REST endpoints

src/main/resources/db/migration/
├── V1__init_placeholder.sql     # From scaffold
├── V2-V9                        # One per scenario
```

---

## Master Execution Outline

Every scenario follows this execution outline. Scenario-specific details (branch name, migration SQL, Java files) are defined in each scenario section. The CI/CD pipeline steps are identical for all.

### Phase A: Developer (Local)

| Step | Action | Detail |
|------|--------|--------|
| A1 | **Create feature branch** | `git checkout -b {branch-name}` from main |
| | | post-checkout hook fires → creates Lakebase branch `{sanitized-branch-name}` |
| | | `.env` updated with branch database connection |
| A2 | **Write Java code** | JPA entities, repositories, services, controllers (scenario-specific) |
| A3 | **Write migration SQL** | `V{N}__{description}.sql` in `src/main/resources/db/migration/` |
| A4 | **Run tests locally** | `./mvnw test` |
| | | Spring Boot starts → Flyway applies migration to branch DB → Hibernate validates entities match → tests execute |
| A5 | **Commit** | `git add -A && git commit -m "{message}"` |
| | | prepare-commit-msg hook fires → schema diff appended to commit |
| A6 | **Push** | `git push -u origin {branch-name}` |
| | | pre-push hook fires → syncs GitHub secrets for CI |

### Phase B: CI/CD Pipeline — PR Workflow (pr.yml, self-hosted runner)

Triggered automatically when the PR is created or updated.

| Step | Action | Detail |
|------|--------|--------|
| B1 | **Checkout code** | `actions/checkout` with `fetch-depth: 0` |
| B2 | **Set up JDK** | Temurin JDK with Maven cache |
| B3 | **Install Databricks CLI** | If not already on runner PATH |
| B4 | **Create CI database branch** | Creates `ci-pr-{N}` Lakebase branch from default (production) branch |
| | | Resolves default branch UID from `list-branches` |
| | | Creates branch with `create-branch` (source = production) |
| | | Waits for READY state (polls up to 2 min) |
| | | Gets or creates primary endpoint, waits for ACTIVE |
| | | Generates database credential + resolves user email |
| | | Outputs JDBC URL, username, password |
| B5 | **Configure datasource** | Sets `SPRING_DATASOURCE_URL/USERNAME/PASSWORD` as env vars for subsequent steps |
| B6 | **Install PostgreSQL client** | For Flyway repair and schema diff (`psql`, `pg_dump`) |
| B7 | **Repair flyway_schema_history** | Removes bogus entries where migration version is recorded but table doesn't exist |
| B8 | **Flyway migrate (CI branch)** | `./mvnw flyway:migrate` against `ci-pr-{N}` database |
| | | Applies the new `V{N}` migration to the CI branch |
| B9 | **Flyway migrate (feature branch)** | Also applies migrations to the feature-named Lakebase branch |
| | | Creates feature Lakebase branch from `ci-pr-{N}` if needed |
| | | Keeps the developer's branch DB in sync with CI |
| B10 | **Run tests** | `./mvnw test` against CI branch database |
| | | Spring Boot starts → Flyway validates → Hibernate validates → all tests execute |
| B11 | **Schema diff (CI vs production)** | `pg_dump --schema-only` on both CI branch and production |
| | | `format-schema-diff.sh` produces human-readable diff |
| | | Shows CREATED/MODIFIED/REMOVED tables with columns |
| B12 | **Post PR comment** | ✅/❌ status + schema diff + workflow run link |
| B13 | **Notify tester queue** | Optional webhook for QA notification |

### Phase C: Merge + Production Deployment (merge.yml, self-hosted runner)

Triggered when the PR is merged to main.

| Step | Action | Detail |
|------|--------|--------|
| C1 | **Checkout code** | Full checkout of main (post-merge) |
| C2 | **Set up JDK + Databricks CLI** | Same as PR workflow |
| C3 | **Resolve production credentials** | Gets default (production) Lakebase branch endpoint + credential |
| C4 | **Flyway migrate (production)** | `./mvnw flyway:migrate` against production database |
| | | Applies `V{N}` migration to production |
| C5 | **Verify schema** | Queries `pg_tables` on production |
| | | Compares expected tables (from all `CREATE TABLE` in migrations) vs actual |
| | | **Fails the workflow** if any tables are missing |
| C6 | **Cleanup Lakebase branches** | Deletes `ci-pr-{N}` branch |
| | | Deletes feature-named Lakebase branch |

### Phase D: Post-Merge Verification

| Step | Action | Detail |
|------|--------|--------|
| D1 | **Verify flyway_schema_history** | `V{N}` exists in production `flyway_schema_history` with `success=true` |
| D2 | **Verify tables on production** | All tables created by the scenario exist (or are dropped, for Scenario 8) |
| D3 | **Verify CI branch cleanup** | `ci-pr-{N}` Lakebase branch no longer exists |
| D4 | **Verify feature branch cleanup** | Feature-named Lakebase branch no longer exists |
| D5 | **Verify main is up to date** | `git pull` on main shows the merge commit |

---

## Scenario 1: Book Entity (Initial Feature)

**Story:** Developer is tasked with adding a book catalog to the new e-commerce app.

**Branch:** `feature/book`
**Migration:** `V2__create_book_table.sql`

```sql
CREATE TABLE IF NOT EXISTS book (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255),
    price DECIMAL(19, 2),
    publish_date DATE
);
```

**Java files (Step A2):**
- `model/Book.java` — JPA entity (id, title, price, publishDate)
- `repository/BookRepository.java` — extends JpaRepository
- `service/BookService.java` — findAll, findById, save, delete
- `controller/BookController.java` — GET /books, POST /books, GET /books/{id}, DELETE /books/{id}

**Commit message (Step A5):** `"Add book entity with CRUD"`

**Post-merge verification (Phase D):**
- `book` table exists on production
- V2 in flyway_schema_history

**Follows:** Master Execution Outline (Phases A → B → C → D)

---

## Scenario 2: Product Catalog

**Story:** The business needs a product catalog with inventory tracking.

**Branch:** `feature/product-catalog`
**Migration:** `V3__create_product_table.sql`

```sql
CREATE TABLE IF NOT EXISTS product (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(19, 2) NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    category VARCHAR(100),
    image_url VARCHAR(512)
);
```

**Java files (Step A2):**
- `model/Product.java` — @Entity with NOT NULL, DEFAULT
- `repository/ProductRepository.java` — findByCategory, findByTitleContaining
- `service/ProductService.java` — CRUD + updateStock
- `controller/ProductController.java` — full REST API

**Commit message:** `"Add product catalog with inventory"`

**Post-merge verification:** `product` table on production, V3 applied

**Follows:** Master Execution Outline

---

## Scenario 3: Customer Registration

**Story:** Customers need to create accounts to shop.

**Branch:** `feature/customer`
**Migration:** `V4__create_customer_table.sql`

```sql
CREATE TABLE IF NOT EXISTS customer (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**Java files (Step A2):**
- `model/Customer.java` — @Column(unique=true) on email
- `repository/CustomerRepository.java` — findByEmail
- `service/CustomerService.java` — register, findByEmail
- `controller/CustomerController.java` — POST /customers, GET /customers/{id}

**Commit message:** `"Add customer registration with email uniqueness"`

**Post-merge verification:** `customer` table with UNIQUE on email, V4 applied

**Follows:** Master Execution Outline

---

## Scenario 4: Shopping Cart

**Story:** Customers need to add products to a shopping cart before checkout.

**Branch:** `feature/cart`
**Migration:** `V5__create_cart_and_cart_item_tables.sql`

```sql
CREATE TABLE IF NOT EXISTS cart (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL UNIQUE REFERENCES customer(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cart_item (
    id BIGSERIAL PRIMARY KEY,
    cart_id BIGINT NOT NULL REFERENCES cart(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES product(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_cart_item_cart_id ON cart_item(cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_item_product_id ON cart_item(product_id);
```

**Java files (Step A2):**
- `model/Cart.java` — @OneToOne with Customer
- `model/CartItem.java` — @ManyToOne to Cart + Product
- `repository/CartRepository.java` — findByCustomerId
- `repository/CartItemRepository.java`
- `service/CartService.java` — getOrCreateCart, addItem, removeItem, clearCart
- `controller/CartController.java` — GET /cart, POST /cart/items, DELETE /cart/items/{id}

**Commit message:** `"Add shopping cart with customer and product references"`

**Post-merge verification:** `cart` + `cart_item` tables with FKs, indexes, CHECK, V5 applied

**Follows:** Master Execution Outline

---

## Scenario 5: Order Processing

**Story:** Customers check out their cart to place orders. Stock must be validated.

**Branch:** `feature/orders`
**Migration:** `V6__create_orders_and_order_item_tables.sql`

```sql
CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL,
    total_amount NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_item (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES product(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price_at_order NUMERIC(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_item_order_id ON order_item(order_id);
```

**Java files (Step A2):**
- `model/Order.java` — @Enumerated for status
- `model/OrderItem.java` — price snapshot at order time
- `model/OrderStatus.java` — enum: PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED
- `repository/OrderRepository.java` — findByCustomerId
- `repository/OrderItemRepository.java`
- `service/OrderService.java` — placeOrder (validate stock, convert cart), updateStatus
- `service/InsufficientStockException.java`
- `controller/OrderController.java` — POST /orders, GET /orders/{id}, PATCH /orders/{id}/status

**Commit message:** `"Add order processing with stock validation"`

**Post-merge verification:** `orders` + `order_item` tables, V6 applied

**Follows:** Master Execution Outline

---

## Scenario 6: Wishlist

**Story:** Customers can save products for later and move them to cart.

**Branch:** `feature/wishlist`
**Migration:** `V7__create_wishlist_tables.sql`

```sql
CREATE TABLE IF NOT EXISTS wishlist (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL UNIQUE REFERENCES customer(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wishlist_item (
    id BIGSERIAL PRIMARY KEY,
    wishlist_id BIGINT NOT NULL REFERENCES wishlist(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
    added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(wishlist_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlist_item_wishlist_id ON wishlist_item(wishlist_id);
```

**Java files (Step A2):**
- `model/Wishlist.java` — @OneToOne Customer
- `model/WishlistItem.java` — compound UNIQUE
- `repository/WishlistRepository.java` — findByCustomerId
- `repository/WishlistItemRepository.java`
- `service/WishlistService.java` — add, remove, moveToCart
- `controller/WishlistController.java` — GET /wishlist, POST /wishlist/items, POST /wishlist/items/{id}/move-to-cart

**Commit message:** `"Add wishlist with move-to-cart functionality"`

**Post-merge verification:** `wishlist` + `wishlist_item` tables, compound UNIQUE, V7 applied

**Follows:** Master Execution Outline

---

## Scenario 7: Schema Evolution — ALTER TABLE

**Story:** Product reviews feature needs rating columns on the product table.

**Branch:** `feature/product-reviews`
**Migration:** `V8__add_product_rating_and_review_count.sql`

```sql
ALTER TABLE product ADD COLUMN average_rating DECIMAL(3, 2) DEFAULT 0.00;
ALTER TABLE product ADD COLUMN review_count INTEGER DEFAULT 0;
```

**Java update (Step A2):** Modify `model/Product.java` — add `averageRating` and `reviewCount` fields

**Note:** No new files — only modifying one existing Java file + adding migration. This tests ALTER TABLE (no CREATE).

**Commit message:** `"Add product rating and review count columns"`

**Post-merge verification:** `average_rating` and `review_count` columns exist on `product` table, V8 applied. Schema diff shows MODIFIED (not CREATED).

**Follows:** Master Execution Outline

---

## Scenario 8: Schema Evolution — DROP TABLE (Remove Book)

**Story:** Business pivot — books are discontinued. Remove the book entity entirely.

**Branch:** `feature/remove-book`
**Migration:** `V9__drop_book_table.sql`

```sql
DROP TABLE IF EXISTS book;
```

**Java deletions (Step A2):**
- Delete `model/Book.java`
- Delete `repository/BookRepository.java`
- Delete `service/BookService.java`
- Delete `controller/BookController.java`

**Note:** Git diff shows 1 file added (migration), 4 files deleted (Java). Tests DROP TABLE and entity removal.

**Commit message:** `"Remove book entity — discontinued product line"`

**Post-merge verification:**
- `book` table does **NOT** exist on production
- V9 applied in flyway_schema_history
- Book Java files absent from repo
- All other tables still exist (no collateral damage)

**Follows:** Master Execution Outline

---

## Test File Structure

```
test/integration/ecommerce/
├── helpers.ts                    # Shared helper functions (no tests)
├── ecommerceScenarios.test.ts    # Top-level orchestrator (setup → 8 scenarios → teardown)
├── scenario1Book.ts              # Scenario 1 test points
├── scenario2Product.ts           # Scenario 2 test points
├── scenario3Customer.ts          # Scenario 3 test points
├── scenario4Cart.ts              # Scenario 4 test points
├── scenario5Orders.ts            # Scenario 5 test points
├── scenario6Wishlist.ts          # Scenario 6 test points
├── scenario7AlterProduct.ts      # Scenario 7 test points
└── scenario8DropBook.ts          # Scenario 8 test points
```

### Orchestrator Flow

```
before()
  → ProjectCreationService.createProject()
  → GitHub repo + Lakebase DB + scaffold + hooks + .env + initial commit

Scenario 1: Book        → Phases A-D → verify book table on production
Scenario 2: Product     → Phases A-D → verify product table
Scenario 3: Customer    → Phases A-D → verify customer table
Scenario 4: Cart        → Phases A-D → verify cart + cart_item
Scenario 5: Orders      → Phases A-D → verify orders + order_item
Scenario 6: Wishlist    → Phases A-D → verify wishlist + wishlist_item
Scenario 7: ALTER       → Phases A-D → verify columns added to product
Scenario 8: DROP        → Phases A-D → verify book table gone

Final Verification
  → 8 migrations in flyway_schema_history (V2-V9)
  → 8 tables exist on production (book dropped)
  → All Java files present except Book stack

after()
  → cleanupProject()
```

---

## Final State After All 8 Scenarios

### Tables on production (8 migrations applied, V2-V9):
- ~~book~~ (created in V2, dropped in V9)
- product (V3, altered in V8: +average_rating, +review_count)
- customer (V4)
- cart (V5), cart_item (V5)
- orders (V6), order_item (V6)
- wishlist (V7), wishlist_item (V7)

### Java files (book stack removed in Scenario 8):
- **Models (9):** Product, Customer, Cart, CartItem, Order, OrderItem, OrderStatus, Wishlist, WishlistItem
- **Repositories (8):** Product, Customer, Cart, CartItem, Order, OrderItem, Wishlist, WishlistItem
- **Services (5+):** Product, Customer, Cart, Order (+InsufficientStockException), Wishlist
- **Controllers (5):** Product, Customer, Cart, Order, Wishlist

### Git history:
8 merge commits, one per scenario, each with a PR number.

---

## Teardown

- Delete GitHub repo (`gh repo delete`)
- Delete Lakebase project (`databricks postgres delete-project`)
- Remove local project directory
