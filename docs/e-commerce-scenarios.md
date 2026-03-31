# E-Commerce Backend — Iterative Feature Development Scenarios

## Overview

Build an e-commerce backend in Java/Spring/JPA with Flyway migrations, iterating through features using the Lakebase SCM workflow. Each scenario simulates what a developer does day-to-day: create a branch, write code + migration, commit, push, open a PR, get it merged.

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

## Scenario 1: Book Entity (Initial Feature)

**Story:** Developer is tasked with adding a book catalog to the new e-commerce app.

**Branch:** `feature/book`

### Developer Steps

1. **Create feature branch**
   - Developer runs: `git checkout -b feature/book`
   - post-checkout hook fires → creates Lakebase branch `feature-book`
   - Developer's `.env` is updated with the branch database connection

2. **Write the Java code**
   - Developer creates `model/Book.java` — JPA entity with @Entity, @Id, @GeneratedValue
   - Developer creates `repository/BookRepository.java` — extends JpaRepository
   - Developer creates `service/BookService.java` — findAll, findById, save, delete
   - Developer creates `controller/BookController.java` — GET /books, POST /books, GET /books/{id}, DELETE /books/{id}

3. **Write the migration SQL**
   - Developer creates `V2__create_book_table.sql` in `src/main/resources/db/migration/`
   - SQL: CREATE TABLE book (id, title, price, publish_date)

4. **Run Flyway migrate on branch database**
   - Developer runs: `./scripts/flyway-migrate.sh` (or `./mvnw flyway:migrate`)
   - `FlywayService.migrate(projectDir)` applies V2 to the Lakebase branch database
   - Developer can now run/test the app against their branch database with the new table

5. **Commit changes**
   - Developer runs: `git add -A && git commit -m "Add book entity with CRUD"`
   - prepare-commit-msg hook fires → schema diff appended to commit message

6. **Push to remote**
   - Developer runs: `git push -u origin feature/book`
   - pre-push hook fires → syncs GitHub secrets for CI

7. **Create pull request**
   - Developer runs: `gh pr create --title "Add book entity" --body "Book CRUD with V2 migration"`
   - This triggers the PR workflow (pr.yml) on the self-hosted actions runner

8. **CI/CD Pipeline executes (pr.yml on self-hosted runner)**
   The following steps run automatically on the self-hosted GitHub Actions runner:

   a. **Checkout code** — actions/checkout with full history (fetch-depth: 0)
   b. **Set up JDK** — Temurin JDK 21/25 with Maven cache
   c. **Install Databricks CLI** — if not already on runner PATH
   d. **Create CI database branch** — creates `ci-pr-{N}` Lakebase branch from the default (production) branch
      - Resolves default branch UID from `list-branches`
      - Creates branch with `create-branch` (source = default branch)
      - Waits for READY state (polls up to 2 min)
      - Gets or creates primary endpoint, waits for ACTIVE
      - Generates database credential + resolves user email
      - Outputs JDBC URL, username, password for subsequent steps
   e. **Configure datasource** — sets SPRING_DATASOURCE_URL/USERNAME/PASSWORD as env vars
   f. **Install PostgreSQL client** — for Flyway repair and schema diff (psql, pg_dump)
   g. **Repair flyway_schema_history** — removes bogus entries where migration version is recorded but table doesn't exist (handles Lakebase transaction edge cases)
   h. **Run Flyway migrate (CI branch)** — `./mvnw flyway:migrate` against ci-pr-{N} database
      - Lists migration files before
      - Runs flyway:info, flyway:migrate, flyway:info
      - This applies V2 (the new migration) to the CI branch database
   i. **Run Flyway migrate (feature-named branch)** — also applies migrations to the `feature-book` Lakebase branch (keeps it in sync with CI)
      - Creates the feature-named Lakebase branch from ci-pr-{N} if it doesn't exist
      - Gets endpoint + credential for the feature branch
      - Runs `./mvnw flyway:migrate` against the feature branch
   j. **Run tests** — `./mvnw test` against the CI branch database
      - Spring Boot starts, Flyway validates (migrations already applied in step h)
      - Hibernate validates entities match schema (`ddl-auto=validate`)
      - All @SpringBootTest and @DataJpaTest tests execute against the real branch DB
   k. **Schema diff (CI vs production)** — generates a comparison:
      - Runs `pg_dump --schema-only` on both CI branch and production
      - Uses `format-schema-diff.sh` to produce a human-readable diff
      - Shows CREATED/MODIFIED/REMOVED tables with column details
      - Falls back to migration version comparison if pg_dump fails
   l. **Post PR comment** — comments on the PR with:
      - ✅ CI passed / ❌ CI failed
      - Schema diff (tables created/modified/removed)
      - Link to workflow run
   m. **Notify tester queue** — optional webhook for QA notification

9. **Merge pull request**
   - Reviewer approves, developer merges
   - This triggers the merge workflow (merge.yml) on the self-hosted runner:
     a. **Resolve production DB credentials** — same as CI step d, but for the default (production) branch
     b. **Flyway migrate (production)** — applies pending migrations to production database
     c. **Verify schema** — confirms all expected tables exist on production (prevents silent DDL failures)
     d. **Cleanup Lakebase branches** — deletes `ci-pr-{N}` and the feature-named Lakebase branch

### Verification Points
- [ ] Feature branch exists in git
- [ ] Lakebase branch `feature-book` exists
- [ ] Java files written (4 files)
- [ ] V2 migration file written
- [ ] `./mvnw test` succeeds on branch database (Flyway applies V2, Hibernate validates, tests pass)
- [ ] `book` table exists on branch database
- [ ] Commit succeeds (prepare-commit-msg hook fires)
- [ ] Push succeeds (pre-push hook fires)
- [ ] PR created successfully
- [ ] CI pipeline: `ci-pr-{N}` Lakebase branch created
- [ ] CI pipeline: Flyway migrate succeeds on CI branch
- [ ] CI pipeline: Flyway migrate succeeds on feature branch
- [ ] CI pipeline: Tests pass against CI branch database
- [ ] CI pipeline: Schema diff posted as PR comment (shows book table CREATED)
- [ ] Merge succeeds
- [ ] Merge pipeline: Flyway applies V2 to production
- [ ] Merge pipeline: Schema verification passes (book table exists)
- [ ] Merge pipeline: `ci-pr-{N}` and `feature-book` Lakebase branches cleaned up
- [ ] V2 in production flyway_schema_history with success=true

---

## Scenario 2: Product Catalog

**Story:** The business needs a product catalog with inventory tracking.

**Branch:** `feature/product-catalog`

### Developer Steps

1. **Create feature branch**
   - `git checkout -b feature/product-catalog` (from main, after Scenario 1 merged)
   - post-checkout hook → Lakebase branch `feature-product-catalog`

2. **Write the migration**
   - `V3__create_product_table.sql`
   - SQL: CREATE TABLE product (id, title, description, price, stock, category, image_url)
   - Uses NOT NULL, DEFAULT 0 for stock

3. **Write the Java code**
   - `model/Product.java` — @Entity with validation annotations
   - `repository/ProductRepository.java` — findByCategory, findByTitleContaining
   - `service/ProductService.java` — CRUD + updateStock
   - `controller/ProductController.java` — full REST API

4. **Commit:** `git add -A && git commit -m "Add product catalog with inventory"`

5. **Push:** `git push -u origin feature/product-catalog`

6. **Create PR:** `gh pr create --title "Add product catalog"`

7. **Merge PR**
   - Production now has: book + product tables

### Verification Points
- [ ] `product` table exists on production with all columns
- [ ] V3 in flyway_schema_history

---

## Scenario 3: Customer Registration

**Story:** Customers need to create accounts to shop.

**Branch:** `feature/customer`

### Developer Steps

1. **Create feature branch** from main (V2 + V3 on main)
   - `git checkout -b feature/customer`
   - Lakebase branch: `feature-customer`

2. **Write the migration**
   - `V4__create_customer_table.sql`
   - SQL: CREATE TABLE customer (id, email UNIQUE, name, password_hash, created_at)
   - UNIQUE constraint on email, TIMESTAMP WITH TIME ZONE

3. **Write the Java code**
   - `model/Customer.java` — @Entity with @Column(unique=true) on email
   - `repository/CustomerRepository.java` — findByEmail
   - `service/CustomerService.java` — register (check duplicate email), findByEmail
   - `controller/CustomerController.java` — POST /customers (register), GET /customers/{id}

4. **Commit:** `"Add customer registration with email uniqueness"`

5. **Push, Create PR, Merge**

### Verification Points
- [ ] `customer` table with UNIQUE on email
- [ ] V4 applied

---

## Scenario 4: Shopping Cart

**Story:** Customers need to add products to a shopping cart before checkout.

**Branch:** `feature/cart`

### Developer Steps

1. **Create feature branch** from main (V2-V4 on main)
   - `git checkout -b feature/cart`
   - Lakebase branch: `feature-cart`

2. **Write the migration**
   - `V5__create_cart_and_cart_item_tables.sql`
   - Two tables: cart (FK → customer), cart_item (FK → cart, FK → product)
   - CHECK constraint: quantity > 0
   - Indexes on cart_item.cart_id and cart_item.product_id

3. **Write the Java code**
   - `model/Cart.java` — @OneToOne with Customer, @OneToMany with CartItem
   - `model/CartItem.java` — @ManyToOne to Cart + Product
   - `repository/CartRepository.java` — findByCustomerId
   - `repository/CartItemRepository.java`
   - `service/CartService.java` — getOrCreateCart, addItem, removeItem, updateQuantity, clearCart
   - `controller/CartController.java` — GET /cart, POST /cart/items, DELETE /cart/items/{id}

4. **Commit:** `"Add shopping cart with customer and product references"`

5. **Push, Create PR, Merge**

### Verification Points
- [ ] `cart` table with FK to customer
- [ ] `cart_item` table with FK to cart + product, CHECK constraint
- [ ] Indexes exist
- [ ] V5 applied

---

## Scenario 5: Order Processing

**Story:** Customers check out their cart to place orders. Stock must be validated.

**Branch:** `feature/orders`

### Developer Steps

1. **Create feature branch** from main (V2-V5 on main)
   - `git checkout -b feature/orders`
   - Lakebase branch: `feature-orders`

2. **Write the migration**
   - `V6__create_orders_and_order_item_tables.sql`
   - orders table: FK → customer, status VARCHAR(32), total_amount NUMERIC
   - order_item table: FK → orders, FK → product, quantity CHECK > 0, price_at_order
   - Indexes on orders.customer_id and order_item.order_id

3. **Write the Java code**
   - `model/Order.java` — @Enumerated for status
   - `model/OrderItem.java` — price snapshot at time of order
   - `model/OrderStatus.java` — enum: PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED
   - `repository/OrderRepository.java` — findByCustomerId
   - `repository/OrderItemRepository.java`
   - `service/OrderService.java` — placeOrder (validate stock, decrement, convert cart), updateStatus, cancel
   - `service/InsufficientStockException.java` — thrown when stock < quantity
   - `controller/OrderController.java` — POST /orders (from cart), GET /orders/{id}, PATCH /orders/{id}/status

4. **Commit:** `"Add order processing with stock validation"`
   - 8+ files in one commit

5. **Push, Create PR, Merge**

### Verification Points
- [ ] `orders` and `order_item` tables with all constraints
- [ ] V6 applied
- [ ] This is the largest commit — many files in diff

---

## Scenario 6: Wishlist

**Story:** Customers can save products for later and move them to cart.

**Branch:** `feature/wishlist`

### Developer Steps

1. **Create feature branch** from main (V2-V6 on main)
   - `git checkout -b feature/wishlist`
   - Lakebase branch: `feature-wishlist`

2. **Write the migration**
   - `V7__create_wishlist_tables.sql`
   - wishlist: @OneToOne with customer (UNIQUE FK)
   - wishlist_item: FK → wishlist + product, compound UNIQUE(wishlist_id, product_id)
   - ON DELETE CASCADE on both FKs

3. **Write the Java code**
   - `model/Wishlist.java` — @OneToOne Customer
   - `model/WishlistItem.java` — @Table(uniqueConstraints)
   - `repository/WishlistRepository.java` — findByCustomerId
   - `repository/WishlistItemRepository.java`
   - `service/WishlistService.java` — add, remove, moveToCart (calls CartService)
   - `controller/WishlistController.java` — GET /wishlist, POST /wishlist/items, POST /wishlist/items/{id}/move-to-cart

4. **Commit:** `"Add wishlist with move-to-cart functionality"`

5. **Push, Create PR, Merge**

### Verification Points
- [ ] `wishlist` and `wishlist_item` tables
- [ ] Compound UNIQUE constraint exists
- [ ] V7 applied

---

## Scenario 7: Schema Evolution — ALTER TABLE

**Story:** Product reviews feature needs rating columns on the product table.

**Branch:** `feature/product-reviews`

### Developer Steps

1. **Create feature branch** from main (V2-V7 on main)
   - `git checkout -b feature/product-reviews`
   - Lakebase branch: `feature-product-reviews`

2. **Write the migration**
   - `V8__add_product_rating_and_review_count.sql`
   - ALTER TABLE product ADD COLUMN average_rating DECIMAL(3,2) DEFAULT 0.00
   - ALTER TABLE product ADD COLUMN review_count INTEGER DEFAULT 0
   - No new table — modifying existing

3. **Update existing Java code**
   - Modify `model/Product.java` — add `averageRating` and `reviewCount` fields with @Column
   - No new files — only modifying one existing file

4. **Commit:** `"Add product rating and review count columns"`
   - Only 2 files changed (migration + Product.java)

5. **Push, Create PR, Merge**

### Verification Points
- [ ] `average_rating` column exists on product table
- [ ] `review_count` column exists on product table
- [ ] V8 applied
- [ ] Schema diff shows MODIFIED (not CREATED)
- [ ] Fewer files in diff than previous scenarios

---

## Scenario 8: Schema Evolution — DROP TABLE (Remove Book)

**Story:** Business pivot — books are discontinued. Remove the book entity entirely.

**Branch:** `feature/remove-book`

### Developer Steps

1. **Create feature branch** from main (V2-V8 on main)
   - `git checkout -b feature/remove-book`
   - Lakebase branch: `feature-remove-book`

2. **Write the migration**
   - `V9__drop_book_table.sql`
   - DROP TABLE IF EXISTS book

3. **Delete the Java code**
   - Delete `model/Book.java`
   - Delete `repository/BookRepository.java`
   - Delete `service/BookService.java`
   - Delete `controller/BookController.java`

4. **Commit:** `"Remove book entity — discontinued product line"`
   - Git diff shows: 1 file added (migration), 4 files deleted (Java)
   - Status codes: A (migration), D D D D (Java files)

5. **Push, Create PR, Merge**

### Verification Points
- [ ] `book` table does NOT exist on production
- [ ] V9 applied
- [ ] Book Java files absent from repo
- [ ] All other tables still exist (no collateral damage)

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

Scenario 1: Book        → feature/book → V2 → merge → verify book table
Scenario 2: Product     → feature/product-catalog → V3 → merge → verify product table
Scenario 3: Customer    → feature/customer → V4 → merge → verify customer table
Scenario 4: Cart        → feature/cart → V5 → merge → verify cart + cart_item
Scenario 5: Orders      → feature/orders → V6 → merge → verify orders + order_item
Scenario 6: Wishlist    → feature/wishlist → V7 → merge → verify wishlist + wishlist_item
Scenario 7: ALTER       → feature/product-reviews → V8 → merge → verify columns added
Scenario 8: DROP        → feature/remove-book → V9 → merge → verify book table gone

Final Verification
  → 8 migrations in flyway_schema_history
  → 8 tables exist (book dropped)
  → All Java files present except Book stack

after()
  → cleanupProject()
```

---

## Verification After Each Scenario

| Check | How |
|-------|-----|
| Feature branch created (git) | `git branch` shows feature branch |
| Feature branch created (Lakebase) | `databricks postgres list-branches` shows matching branch |
| Migration file in commit | `git diff-tree` includes V*.sql |
| post-checkout hook fired | Lakebase branch exists after checkout |
| prepare-commit-msg hook fired | Commit message or schema diff appended |
| pre-push hook fired | Push succeeds, secrets synced |
| PR created | `gh pr create` succeeds |
| Merge succeeds | `gh pr merge` succeeds |
| Flyway applied migration | `flyway_schema_history` shows version + success |
| Tables exist/modified/dropped | `psql \dt` or SELECT confirms schema state |
| CI branch cleaned up | CI branch deleted after merge |

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
