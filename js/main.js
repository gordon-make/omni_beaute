(function () {
  const WHATSAPP_NUMBER = "85262315933";
  const CATALOG_URL = "data/products.json";

  const toggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".nav");

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  document.querySelectorAll(".faq-item").forEach(function (item) {
    const button = item.querySelector("button");
    if (!button) {
      return;
    }
    button.addEventListener("click", function () {
      const open = item.classList.toggle("is-open");
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  loadProducts();
  setupProductNav();

  function ensureProductScroller() {
    const grid = document.getElementById("product-grid");
    if (!grid) {
      return null;
    }
    if (grid.closest(".product-scroller")) {
      return grid;
    }

    grid.classList.remove("service-grid");
    grid.setAttribute("tabindex", "0");

    const scroller = document.createElement("div");
    scroller.className = "product-scroller";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "product-nav product-nav-prev";
    prev.setAttribute("aria-label", "上一項產品");
    prev.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M14.5 5.5 8.5 12l6 6.5"/></svg>';

    const next = document.createElement("button");
    next.type = "button";
    next.className = "product-nav product-nav-next";
    next.setAttribute("aria-label", "下一項產品");
    next.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9.5 5.5 15.5 12l-6 6.5"/></svg>';

    grid.parentNode.insertBefore(scroller, grid);
    scroller.appendChild(prev);
    scroller.appendChild(grid);
    scroller.appendChild(next);
    return grid;
  }

  function loadProducts() {
    const grid = ensureProductScroller();
    if (!grid) {
      return;
    }

    fetch(CATALOG_URL, { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("catalog " + response.status);
        }
        return response.json();
      })
      .then(function (data) {
        const products = Array.isArray(data && data.products) ? data.products : [];
        renderProducts(grid, products);
      })
      .catch(function () {
        setProductStatus(
          grid,
          "error",
          "產品資料暫時未能載入。請用本機伺服器開啟網站，或直接 WhatsApp 查詢。"
        );
      });
  }

  function renderProducts(grid, products) {
    const visible = products.filter(function (product) {
      return product && product.active !== false;
    });

    if (!visible.length) {
      setProductStatus(grid, "empty", "暫時未有產品上架，歡迎 WhatsApp 查詢。");
      return;
    }

    grid.setAttribute("data-status", "ready");
    grid.replaceChildren();

    visible.forEach(function (product) {
      grid.appendChild(createProductCard(product));
    });
  }

  function createProductCard(product) {
    const article = document.createElement("article");
    article.className = "card";

    const imageSrc = safeImageSrc(product.image);
    if (imageSrc) {
      const img = document.createElement("img");
      img.src = imageSrc;
      img.alt = textOf(product.name) || "產品照片";
      article.appendChild(img);
    }

    const body = document.createElement("div");
    body.className = "card-body";

    if (product.preview) {
      const chip = document.createElement("span");
      chip.className = "product-chip";
      chip.textContent = "預覽";
      body.appendChild(chip);
    }

    const title = document.createElement("h3");
    title.textContent = textOf(product.name) || "產品";
    body.appendChild(title);

    if (textOf(product.price)) {
      const price = document.createElement("p");
      price.className = "product-price";
      price.textContent = textOf(product.price);
      body.appendChild(price);
    }

    if (textOf(product.description)) {
      const description = document.createElement("p");
      description.textContent = textOf(product.description);
      body.appendChild(description);
    }

    const link = document.createElement("a");
    link.className = "btn";
    link.target = "_blank";
    link.rel = "noopener";
    link.href = whatsappUrl(product);
    link.textContent = "查詢此產品";
    body.appendChild(link);

    article.appendChild(body);
    return article;
  }

  function setupProductNav() {
    const grid = ensureProductScroller();
    const scroller = grid && grid.closest(".product-scroller");
    if (!scroller || !grid) {
      return;
    }

    const prev = scroller.querySelector(".product-nav-prev");
    const next = scroller.querySelector(".product-nav-next");

    if (prev) {
      prev.addEventListener("click", function () {
        grid.scrollBy({ left: -productStep(grid), behavior: "smooth" });
      });
    }
    if (next) {
      next.addEventListener("click", function () {
        grid.scrollBy({ left: productStep(grid), behavior: "smooth" });
      });
    }

    grid.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        grid.scrollBy({ left: -productStep(grid), behavior: "smooth" });
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        grid.scrollBy({ left: productStep(grid), behavior: "smooth" });
      }
    });
  }

  function productStep(grid) {
    const card = grid.querySelector(".card");
    if (!card) {
      return 280;
    }
    const styles = window.getComputedStyle(grid);
    const gap = parseFloat(styles.columnGap || styles.gap) || 22;
    return card.getBoundingClientRect().width + gap;
  }

  function setProductStatus(grid, status, message) {
    grid.setAttribute("data-status", status);
    const note = document.createElement("p");
    note.className = "product-status";
    note.textContent = message;
    grid.replaceChildren(note);
  }

  function whatsappUrl(product) {
    const name = textOf(product.name) || "產品";
    const message = "你好，我想查詢 Omni Beauté 產品：" + name + "。";
    return "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(message);
  }

  function safeImageSrc(src) {
    if (!src || typeof src !== "string") {
      return "";
    }
    const trimmed = src.trim();
    if (trimmed.indexOf("assets/") === 0 && trimmed.indexOf("..") === -1) {
      return trimmed;
    }
    return "";
  }

  function textOf(value) {
    return value == null ? "" : String(value).trim();
  }
}());
