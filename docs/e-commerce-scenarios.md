# E-Commerce Backend — Iterative Feature Development Scenarios

## Overview

Build an e-commerce backend in Java/Spring/JPA with Flyway migrations, iterating through features using the Lakebase SCM workflow. Each scenario creates a git feature branch and a Lakebase database branch, develops the feature (migration SQL + Java code), and merges to main.

This tests the full project creation and iterative development lifecycle end-to-end:
- `ProjectCreationService` creates the project (GitHub repo + Lakebase DB + scaffold)
- Each scenario uses the git + Lakebase branch workflow
- Hooks fire at each step (post-checkout, prepare-commit-msg, pre-push)
- Merge workflow runs Flyway on production + verifies schema

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
├── V2__create_book_table.sql    # Scenario 1
├── V3__create_product_table.sql # Scenario 2
├── V4__create_customer_table.sql # Scenario 3
├── V5__create_cart_and_cart_item_tables.sql # Scenario 4
├── V6__create_orders_and_order_item_tables.sql # Scenario 5
├── V7__create_wishlist_tables.sql # Scenario 6
├── V8__add_product_rating_and_review_count.sql # Scenario 7
└── V9__drop_book_table.sql      # Scenario 8
```

---

## Scenario 1: Book Entity (Initial Feature)

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

**Java files:**
- `model/Book.java` — JPA entity (id, title, price, publishDate)
- `repository/BookRepository.java` — Spring Data JPA
- `service/BookService.java` — CRUD operations
- `controller/BookController.java` — REST endpoints (GET /books, POST /books, etc.)

**What exercises:**
- First feature branch creation (git + Lakebase)
- post-checkout hook fires → creates Lakebase branch
- Migration file detected in commit diff
- prepare-commit-msg hook fires → schema diff appended
- pre-push hook fires → secrets synced
- PR creation
- Merge to main → Flyway applies V2 → book table exists on production

---

## Scenario 2: Product Catalog

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

**Java files:**
- `model/Product.java` — JPA entity (id, title, description, price, stock, category, imageUrl)
- `repository/ProductRepository.java`
- `service/ProductService.java` — CRUD + stock management
- `controller/ProductController.java` — REST endpoints

**What exercises:**
- Second feature branch on same project
- Independent entity (no FK dependencies)
- NOT NULL constraints, DEFAULT values in migration

---

## Scenario 3: Customer Registration

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

**Java files:**
- `model/Customer.java` — JPA entity (id, email, name, passwordHash, createdAt)
- `repository/CustomerRepository.java` — findByEmail
- `service/CustomerService.java` — register, authenticate
- `controller/CustomerController.java` — REST endpoints

**What exercises:**
- UNIQUE constraint in migration
- Timestamp with timezone
- Third sequential feature → V4 builds on V2 + V3 being on main

---

## Scenario 4: Shopping Cart

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

**Java files:**
- `model/Cart.java` — JPA entity with @OneToOne to Customer
- `model/CartItem.java` — JPA entity with @ManyToOne to Cart + Product
- `repository/CartRepository.java`
- `repository/CartItemRepository.java`
- `service/CartService.java` — add/remove items, get cart, clear cart
- `controller/CartController.java` — REST endpoints

**What exercises:**
- Foreign keys referencing tables from Scenarios 2 & 3 (product + customer)
- Multiple tables in one migration
- Index creation
- CHECK constraint
- CASCADE delete

---

## Scenario 5: Order Processing

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

**Java files:**
- `model/Order.java` — JPA entity with status, FK to Customer
- `model/OrderItem.java` — FK to Order + Product, price snapshot
- `model/OrderStatus.java` — enum (PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED)
- `repository/OrderRepository.java`
- `repository/OrderItemRepository.java`
- `service/OrderService.java` — placeOrder (from cart), updateStatus, cancel
- `service/InsufficientStockException.java`
- `controller/OrderController.java` — REST endpoints

**What exercises:**
- Complex migration with CHECK constraints
- Service with business logic (stock validation, cart-to-order conversion)
- Enum type in Java mapped to VARCHAR in SQL
- Multiple new files (8+) in one commit

---

## Scenario 6: Wishlist

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

**Java files:**
- `model/Wishlist.java` — @OneToOne with Customer
- `model/WishlistItem.java` — compound UNIQUE (wishlist + product)
- `repository/WishlistRepository.java`
- `repository/WishlistItemRepository.java`
- `service/WishlistService.java` — add/remove items, move to cart
- `controller/WishlistController.java` — REST endpoints

**What exercises:**
- Compound UNIQUE constraint in migration
- Cross-service interaction (WishlistService calls CartService for move-to-cart)
- ON DELETE CASCADE on FK

---

## Scenario 7: Schema Evolution — ALTER TABLE

**Branch:** `feature/product-reviews`
**Migration:** `V8__add_product_rating_and_review_count.sql`

```sql
ALTER TABLE product ADD COLUMN average_rating DECIMAL(3, 2) DEFAULT 0.00;
ALTER TABLE product ADD COLUMN review_count INTEGER DEFAULT 0;
```

**Java update:** Modify `model/Product.java` to add `averageRating` and `reviewCount` fields.

**What exercises:**
- ALTER TABLE migration (no CREATE)
- Modifying an existing JPA entity (not creating new)
- Schema diff shows MODIFIED table vs CREATED
- DEFAULT values on new columns (backward compatible)
- Fewer files changed than previous scenarios (migration + 1 Java file)

---

## Scenario 8: Schema Evolution — DROP TABLE (Remove Book)

**Branch:** `feature/remove-book`
**Migration:** `V9__drop_book_table.sql`

```sql
DROP TABLE IF EXISTS book;
```

**Java deletions:**
- Delete `model/Book.java`
- Delete `repository/BookRepository.java`
- Delete `service/BookService.java`
- Delete `controller/BookController.java`

**What exercises:**
- DROP TABLE migration
- Deleted files in git diff (status = D)
- Removing a full entity stack (model + repo + service + controller)
- Schema diff shows REMOVED table
- Verifying the table no longer exists on production after merge

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
| PR can be created | `gh pr create` succeeds |
| Merge to main | `gh pr merge` succeeds |
| Flyway applied migration | `flyway_schema_history` shows version + success |
| Tables exist/modified/dropped | `\dt` or `SELECT` confirms schema state |
| Lakebase CI branch cleaned up | CI branch deleted after merge |

---

## Final State After All 8 Scenarios

### Tables on production (8 migrations applied, V2-V9):
- ~~book~~ (dropped in V9)
- product (with average_rating + review_count from V8)
- customer
- cart, cart_item
- orders, order_item
- wishlist, wishlist_item

### Java files (book stack removed in Scenario 8):
- **Models (5):** Product, Customer, Cart, CartItem, Order, OrderItem, OrderStatus, Wishlist, WishlistItem
- **Repositories (7):** Product, Customer, Cart, CartItem, Order, OrderItem, Wishlist, WishlistItem
- **Services (5):** Product, Customer, Cart, Order (+ InsufficientStockException), Wishlist
- **Controllers (5):** Product, Customer, Cart, Order, Wishlist

### Git history:
8 merge commits, one per scenario, each with a PR number.

---

## Teardown

- Delete GitHub repo (`gh repo delete`)
- Delete Lakebase project (`databricks postgres delete-project`)
- Remove local project directory
