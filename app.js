const STORAGE_KEYS = {
  site: 'wfd-site-config-v1',
  theme: 'wfd-theme-v1',
  pantry: 'wfd-pantry-v2',
  grocery: 'wfd-grocery-v2',
  mealPlan: 'wfd-meal-plan-v1',
  sections: 'wfd-sections-v1',
  stockDefaults: 'wfd-stock-defaults-v1',
  stockOverrides: 'wfd-stock-overrides-v1',
};

const PAGE_SIZE = 10;

const BASE_CATEGORY_DEFAULTS = {
  spices: true,
  sauces: true,
  pantry: true,
  bakery: false,
  dairy: false,
  meats: false,
  veggies: false,
  grains: false,
};

let categoryStockDefaults = {
  ...BASE_CATEGORY_DEFAULTS,
  ...(readJson(STORAGE_KEYS.stockDefaults, {}) || {}),
};

// per-item overrides: "always" | "never" | undefined (use category default)
let ingredientStockOverrides = readJson(STORAGE_KEYS.stockOverrides, {}) || {};

const CATEGORY_DEFS = [
  { key: 'meats', label: 'Meats', icon: '🥩', description: 'Choose proteins you have on hand.', placeholder: 'Add meat' },
  { key: 'veggies', label: 'Veggies', icon: '🥦', description: 'Track produce and fresh ingredients.', placeholder: 'Add veggie' },
  { key: 'grains', label: 'Grains', icon: '🍚', description: 'Rice, pasta, tortillas, and similar staples.', placeholder: 'Add grain' },
  { key: 'dairy', label: 'Dairy', icon: '🧀', description: 'Milk, cheese, butter, and fridge staples.', placeholder: 'Add dairy item' },
  { key: 'spices', label: 'Spices', icon: '🧂', description: 'Seasonings, rubs, and dry spices.', placeholder: 'Add spice' },
  { key: 'sauces', label: 'Sauces', icon: '🥫', description: 'Condiments, sauces, and dressings.', placeholder: 'Add sauce' },
  { key: 'bakery', label: 'Bakery', icon: '🥖', description: 'Bread, buns, wraps, and baked basics.', placeholder: 'Add bakery item' },
  { key: 'pantry', label: 'Pantry', icon: '🥣', description: 'Shelf-stable cooking and baking staples.', placeholder: 'Add pantry item' },
];

const CATEGORY_KEYS = CATEGORY_DEFS.map(category => category.key);

const APP_DEFAULTS = {
  branding: {
    title: 'What the !#$%&@ is for Dinner?',
    tagline: 'Tonight’s plan starts here',
  },
  themes: [
    { id: 'citrus', name: 'Citrus Pop' },
    { id: 'garden', name: 'Fresh Garden' },
    { id: 'berry', name: 'Berry Bright' },
    { id: 'farmhouse', name: 'Farmhouse' },
    { id: 'diner', name: 'Retro Diner' },
    { id: 'lemon', name: 'Lemon Kitchen' },
    { id: 'copper', name: 'Slate & Copper' },
    { id: 'midnight', name: 'Midnight Kitchen' },
  ],
  defaultTheme: 'citrus',
  ingredients: {},
};

const CATEGORY_SLUG_TO_UI_KEY = {
  meat: 'meats',
  meats: 'meats',
  protein: 'meats',
  veggie: 'veggies',
  veggies: 'veggies',
  vegetable: 'veggies',
  vegetables: 'veggies',
  grain: 'grains',
  grains: 'grains',
  dairy: 'dairy',
  spice: 'spices',
  spices: 'spices',
  sauce: 'sauces',
  sauces: 'sauces',
  bakery: 'bakery',
  pantry: 'pantry',
  other: 'pantry',
};


const UNIT_ALIASES = {
  '': 'count',
  count: 'count',
  piece: 'count',
  pieces: 'count',
  each: 'count',
  whole: 'count',
  medium: 'count',
  small: 'count',
  large: 'count',
  clove: 'clove',
  cloves: 'clove',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  cup: 'cup',
  cups: 'cup',
  tbsp: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tsp: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  can: 'can',
  cans: 'can',
  package: 'package',
  packages: 'package',
  packet: 'packet',
  packets: 'packet',
  slice: 'slice',
  slices: 'slice',
  bunch: 'bunch',
  bunches: 'bunch',
};

let recipes = [];
let siteConfig = null;
let currentTheme = 'citrus';
let currentPage = 1;
let activeRecipe = null;
let activeRecipeServings = 4;
let pantryCounts = {};
let groceryItems = [];
let mealPlan = [];
let sectionState = {
  recipes: false,
  shopping: false,
  'meal-plan': false,
  ingredients: false,
  ...Object.fromEntries(CATEGORY_KEYS.map(key => [`ingredients-${key}`, true])),
};
let activeRecipeFile = 'all';
let recipeFileOptions = [];
let currentSession = null;
let currentUser = null;
let currentRoles = [];
let authSubscription = null;

const el = {};

document.addEventListener('DOMContentLoaded', async () => {
  cacheElements();
  bindStaticEvents();
  try {
    await initializeApp();
  } catch (error) {
    console.error('App initialization failed:', error);
    if (el.matchSummary) el.matchSummary.textContent = 'App failed to load. Check Supabase setup and browser console.';
    if (el.resultsCount) el.resultsCount.textContent = 'Load failed';
  }
});

function cacheElements() {
  el.appTitle = document.getElementById('app-title');
  el.appTagline = document.getElementById('app-tagline');
  el.recipeList = document.getElementById('recipe-list');
  el.resultsCount = document.getElementById('results-count');
  el.matchSummary = document.getElementById('match-summary');
  el.recipePagination = document.getElementById('recipe-pagination');
  el.recipeFileFilter = document.getElementById('recipe-file-filter');
  el.ingredientCategories = document.getElementById('ingredient-categories');
  el.groceryList = document.getElementById('grocery-list');
  el.groceryRecipeSummary = document.getElementById('grocery-recipe-summary');
  el.mealPlanSummary = document.getElementById('meal-plan-summary');
  el.mealPlanList = document.getElementById('meal-plan-list');
  el.mealPlanShopping = document.getElementById('meal-plan-shopping');
  el.recipeModal = document.getElementById('recipe-modal');
  el.modalTitle = document.getElementById('modal-title');
  el.modalMeta = document.getElementById('modal-meta');
  el.tabGrocery = document.getElementById('tab-grocery');
  el.tabDirections = document.getElementById('tab-directions');
  el.settingsModal = document.getElementById('settings-modal');
  el.themeOptions = document.getElementById('theme-options');
  el.titleInput = document.getElementById('title-input');
  el.taglineInput = document.getElementById('tagline-input');
  el.settingsNav = document.getElementById('settings-nav-dynamic');
  el.settingsCategoryPages = document.getElementById('settings-category-pages');
  el.accountBtn = document.getElementById('account-btn');
  el.logoutBtn = document.getElementById('logout-btn');
  el.accountStatus = document.getElementById('account-status');
  el.loginModal = document.getElementById('login-modal');
  el.loginEmail = document.getElementById('login-email');
  el.loginPassword = document.getElementById('login-password');
  el.loginSubmit = document.getElementById('login-submit-btn');
  el.forgotPasswordBtn = document.getElementById('forgot-password-btn');
  el.loginMessage = document.getElementById('login-message');
}

function bindStaticEvents() {
  el.accountBtn?.addEventListener('click', openLoginModal);
  el.logoutBtn?.addEventListener('click', signOutCurrentUser);
  el.loginSubmit?.addEventListener('click', signInWithEmailPassword);
  el.forgotPasswordBtn?.addEventListener('click', sendPasswordReset);

  document.getElementById('clear-filters-btn')?.addEventListener('click', () => {
    pantryCounts = {};
    persistPantry();
    currentPage = 1;
    renderAll();
  });

  document.getElementById('settings-btn')?.addEventListener('click', openSettingsModal);
  document.getElementById('recipe-file-filter')?.addEventListener('change', onRecipeFileFilterChange);
  document.getElementById('save-settings-btn')?.addEventListener('click', saveSettings);
  document.getElementById('reset-settings-btn')?.addEventListener('click', resetSettings);
  document.getElementById('copy-shopping-list-btn')?.addEventListener('click', copyShoppingList);

  document.getElementById('clear-grocery-btn')?.addEventListener('click', () => {
    groceryItems = [];
    persistGrocery();
    renderGroceryList();
    if (activeRecipe) renderRecipeModal();
  });

  document.getElementById('clear-meal-plan-btn')?.addEventListener('click', () => {
    mealPlan = [];
    persistMealPlan();
    renderMealPlan();
    renderRecipes();
    if (activeRecipe) renderRecipeModal();
  });

  document.getElementById('add-plan-shortages-btn')?.addEventListener('click', addMealPlanShortagesToGrocery);

  document.querySelectorAll('[data-close-modal="true"]').forEach(node => {
    node.addEventListener('click', closeRecipeModal);
  });

  document.querySelectorAll('[data-close-settings="true"]').forEach(node => {
    node.addEventListener('click', closeSettingsModal);
  });

  document.querySelectorAll('[data-close-login="true"]').forEach(node => {
    node.addEventListener('click', closeLoginModal);
  });

  document.querySelectorAll('.modal-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setRecipeModalTab(btn.dataset.tab));
  });

  document.querySelectorAll('.settings-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => setSettingsTab(btn.dataset.settingsTab));
  });

  document.querySelectorAll('[data-toggle-section]').forEach(btn => {
    btn.addEventListener('click', () => toggleSection(btn.dataset.toggleSection));
  });

  document.addEventListener('click', (event) => {
    const settingsBtn = event.target.closest('.settings-nav-btn');
    if (settingsBtn) {
      setSettingsTab(settingsBtn.dataset.settingsTab);
      return;
    }

    const addBtn = event.target.closest('[data-add-ingredient]');
    if (addBtn) {
      addIngredient(addBtn.dataset.addIngredient);
      return;
    }

    const ingredientToggle = event.target.closest('[data-toggle-ingredient-category]');
    if (ingredientToggle) {
      toggleSection(`ingredients-${ingredientToggle.dataset.toggleIngredientCategory}`);
      return;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeRecipeModal();
      closeSettingsModal();
      closeLoginModal();
    }
  });
}

async function initializeApp() {
  const { ingredientCatalog, loadedRecipes, recipeFiles, appSettings } = await loadAppDataFromSupabase();
  siteConfig = buildSiteConfig({
    ...APP_DEFAULTS,
    branding: {
      title: appSettings?.title || APP_DEFAULTS.branding.title,
      tagline: appSettings?.tagline || APP_DEFAULTS.branding.tagline,
    },
    defaultTheme: appSettings?.default_theme || APP_DEFAULTS.defaultTheme,
  }, readStoredSiteConfig(), ingredientCatalog);

  recipeFileOptions = recipeFiles;
  recipes = loadedRecipes.map(recipe => normalizeRecipe(recipe)).filter(Boolean);

  pantryCounts = migratePantryStore(readJson(STORAGE_KEYS.pantry, {}));
  groceryItems = migrateGroceryStore(readJson(STORAGE_KEYS.grocery, []));
  mealPlan = migrateMealPlanStore(readJson(STORAGE_KEYS.mealPlan, []));
  sectionState = { ...sectionState, ...(readJson(STORAGE_KEYS.sections, {}) || {}) };
  currentTheme = localStorage.getItem(STORAGE_KEYS.theme) || siteConfig.defaultTheme || 'citrus';

  pantryCounts = applyStockDefaults(pantryCounts, siteConfig.ingredients);
  enrichIngredientProfiles();
  applyBranding();
  applyTheme(currentTheme);
  populateRecipeFileFilter();
  renderAll();

  await initializeAuth();
}

async function loadAppDataFromSupabase() {
  const supabaseClient = window.supabaseClient;
  if (!supabaseClient) {
    throw new Error('Supabase client not found. Check index.html initialization.');
  }

  const [recipesResult, stepsResult, recipeIngredientsResult, ingredientsResult, ingredientCategoriesResult, appSettingsResult] = await Promise.all([
    supabaseClient.from('recipes').select('*').eq('is_active', true).order('name', { ascending: true }),
    supabaseClient.from('recipe_steps').select('*').order('step_number', { ascending: true }),
    supabaseClient.from('recipe_ingredients').select('*').order('sort_order', { ascending: true }),
    supabaseClient.from('ingredients').select('*').eq('is_active', true).order('name', { ascending: true }),
    supabaseClient.from('ingredient_categories').select('*').order('sort_order', { ascending: true }),
    supabaseClient.from('app_settings').select('*').eq('id', 'global').maybeSingle(),
  ]);

  if (recipesResult.error) throw recipesResult.error;
  if (stepsResult.error) throw stepsResult.error;
  if (recipeIngredientsResult.error) throw recipeIngredientsResult.error;
  if (ingredientsResult.error) throw ingredientsResult.error;
  if (ingredientCategoriesResult.error) throw ingredientCategoriesResult.error;
  if (appSettingsResult.error) throw appSettingsResult.error;

  const recipesData = recipesResult.data || [];
  const stepsData = stepsResult.data || [];
  const recipeIngredientsData = recipeIngredientsResult.data || [];
  const ingredientsData = ingredientsResult.data || [];
  const ingredientCategoriesData = ingredientCategoriesResult.data || [];

  const ingredientCategoryById = Object.fromEntries(ingredientCategoriesData.map(category => [category.id, category]));
  const ingredientsById = Object.fromEntries(ingredientsData.map(ingredient => [ingredient.id, ingredient]));

  const ingredientCatalog = CATEGORY_KEYS.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});

  ingredientsData.forEach(ingredient => {
    const category = ingredientCategoryById[ingredient.ingredient_category_id];
    const uiKey = CATEGORY_SLUG_TO_UI_KEY[category?.slug] || 'pantry';
    ingredientCatalog[uiKey].push({
      id: ingredient.slug || ingredient.id,
      name: ingredient.name,
      pantryUnit: ingredient.default_unit || '',
    });
  });

  Object.values(ingredientCatalog).forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)));

  const stepsByRecipeId = {};
  stepsData.forEach(step => {
    if (!stepsByRecipeId[step.recipe_id]) stepsByRecipeId[step.recipe_id] = [];
    stepsByRecipeId[step.recipe_id].push(step);
  });

  const recipeIngredientsByRecipeId = {};
  recipeIngredientsData.forEach(item => {
    if (!recipeIngredientsByRecipeId[item.recipe_id]) recipeIngredientsByRecipeId[item.recipe_id] = [];
    recipeIngredientsByRecipeId[item.recipe_id].push(item);
  });

  const loadedRecipes = recipesData.map(recipeRow => {
    const ingredientBuckets = CATEGORY_KEYS.reduce((acc, key) => {
      acc[key] = [];
      return acc;
    }, {});

    const recipeIngredientRows = recipeIngredientsByRecipeId[recipeRow.id] || [];

    recipeIngredientRows.forEach(recipeIngredient => {
      const ingredient = ingredientsById[recipeIngredient.ingredient_id];
      if (!ingredient) return;
      const category = ingredientCategoryById[ingredient.ingredient_category_id];
      const uiKey = CATEGORY_SLUG_TO_UI_KEY[category?.slug] || 'pantry';
      if (!ingredientBuckets[uiKey].includes(ingredient.name)) {
        ingredientBuckets[uiKey].push(ingredient.name);
      }
    });

    Object.values(ingredientBuckets).forEach(list => list.sort((a, b) => a.localeCompare(b)));

    const directions = (stepsByRecipeId[recipeRow.id] || [])
      .sort((a, b) => a.step_number - b.step_number)
      .map(step => step.instruction);

	return {
	  id: recipeRow.slug,
	  name: recipeRow.name,
	  description: recipeRow.description || '',
	  time: recipeRow.time_label || '',
	  difficulty: recipeRow.difficulty || '',
	  servings: Number(recipeRow.default_servings) || 4,
	  ingredients: ingredientBuckets,
	  groceryList: recipeIngredientRows.map(item => item.display_text).filter(Boolean),
	  directions,
	  sourceFile: recipeRow.source_group || 'all',
	  sourceLabel: recipeRow.source_label || humanizeRecipeFileName(recipeRow.source_group || 'all'),
	};
  });

		const recipeGroupMap = new Map();

		recipesData.forEach(recipe => {
		  const value = recipe.source_group || 'all';
		  const label = recipe.source_label || humanizeRecipeFileName(value);
		  if (value !== 'all' && !recipeGroupMap.has(value)) {
			recipeGroupMap.set(value, { value, label });
		  }
		});

		return {
		  ingredientCatalog,
		  loadedRecipes,
		  recipeFiles: [
			{ value: 'all', label: 'All recipes' },
			...Array.from(recipeGroupMap.values()).sort((a, b) => a.label.localeCompare(b.label)),
		  ],
		  appSettings: appSettingsResult.data || null,
		};
}

function getIngredientDefaultStock(category, itemName) {
  const key = normalizeIngredient(itemName);
  const override = ingredientStockOverrides[key];

  if (override === 'always') return true;
  if (override === 'never') return false;

  return Boolean(categoryStockDefaults[category]);
}

function applyStockDefaults(currentPantryCounts, ingredientsByCategory) {
  const updated = { ...currentPantryCounts };

  Object.entries(ingredientsByCategory || {}).forEach(([category, items]) => {
    (items || []).forEach(item => {
      const key = normalizeIngredient(item.name);
      if (!key) return;

      if (!(key in updated)) {
        updated[key] = getIngredientDefaultStock(category, item.name) ? 1 : 0;
      }
    });
  });

  return updated;
}

function persistStockSettings() {
  localStorage.setItem(STORAGE_KEYS.stockDefaults, JSON.stringify(categoryStockDefaults));
  localStorage.setItem(STORAGE_KEYS.stockOverrides, JSON.stringify(ingredientStockOverrides));
  queueSaveUserPreferences();
}

function cycleIngredientStockOverride(itemName) {
  const key = normalizeIngredient(itemName);
  const current = ingredientStockOverrides[key];

  let next;
  if (!current) next = 'always';
  else if (current === 'always') next = 'never';
  else next = undefined;

  if (next) ingredientStockOverrides[key] = next;
  else delete ingredientStockOverrides[key];

  persistStockSettings();

  pantryCounts = applyStockDefaults(pantryCounts, siteConfig.ingredients);
  persistPantry();
  renderAll();
}

function setCategoryStockDefault(categoryKey, isAlwaysStocked) {
  categoryStockDefaults[categoryKey] = Boolean(isAlwaysStocked);
  persistStockSettings();

  pantryCounts = applyStockDefaults(pantryCounts, siteConfig.ingredients);
  persistPantry();
  renderAll();
}


function humanizeRecipeFileName(fileName) {
  return String(fileName || 'recipes')
    .replace(/\.json$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\brecipes\b/i, '')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase()) || 'Recipes';
}

function populateRecipeFileFilter() {
  if (!el.recipeFileFilter) return;
  el.recipeFileFilter.innerHTML = '<option value="all">All recipe files</option>';

  recipeFileOptions.forEach(optionDef => {
    const option = document.createElement('option');
    option.value = optionDef.value;
    option.textContent = optionDef.label;
    option.selected = optionDef.value === activeRecipeFile;
    el.recipeFileFilter.appendChild(option);
  });
}

function onRecipeFileFilterChange() {
  activeRecipeFile = el.recipeFileFilter?.value || 'all';
  currentPage = 1;
  renderRecipes();
}

function normalizeRecipe(recipe) {
  if (!recipe || !recipe.id || !recipe.name) return null;

  const ingredientNames = getRecipeIngredientNames(recipe);
  const inferredItems = Array.isArray(recipe.groceryItems) && recipe.groceryItems.length
    ? recipe.groceryItems
    : deriveGroceryItemsFromLines(recipe.groceryList || [], ingredientNames);

  const normalizedItems = inferredItems
    .map((item, index) => normalizeGroceryItem(item, ingredientNames, recipe, index))
    .filter(Boolean);

  let pantryTrackableItems = normalizedItems.filter(item => item.trackPantry);

  if (!pantryTrackableItems.length) {
    const fallbackTrackableItems = [];

    CATEGORY_KEYS.forEach(categoryKey => {
      const items = Array.isArray(recipe.ingredients?.[categoryKey]) ? recipe.ingredients[categoryKey] : [];
      items.forEach((name, index) => {
        const normalizedName = String(name || '').trim();
        if (!normalizedName) return;

        fallbackTrackableItems.push({
          id: `${recipe.id}-fallback-${categoryKey}-${index}-${slugify(normalizedName)}`,
          kind: 'structured',
          quantity: 1,
          unit: 'count',
          name: normalizedName,
          display: normalizedName,
          pantryKey: normalizeIngredient(normalizedName),
          trackPantry: true,
        });
      });
    });

    pantryTrackableItems = fallbackTrackableItems;
  }

  return {
    ...recipe,
    servings: Number(recipe.servings) || 4,
    groceryItems: normalizedItems,
    pantryTrackableItems,
    ingredientNames,
  };
}

function deriveGroceryItemsFromLines(lines, ingredientNames) {
  return (lines || []).map((line) => {
    const parsed = parseIngredientLine(line);
    if (!parsed) {
      return { display: line };
    }
    const pantryKey = inferPantryKey(parsed.name, ingredientNames);
    return {
      quantity: parsed.quantity,
      unit: parsed.unit,
      name: parsed.name,
      pantryKey,
      display: line,
    };
  });
}

function normalizeGroceryItem(item, ingredientNames, recipe, index) {
  if (!item) return null;

  if (item.display && (item.quantity == null || !item.name)) {
    return {
      id: `${recipe.id}-display-${index}`,
      kind: 'display',
      display: item.display,
      trackPantry: false,
    };
  }

  const quantity = Number(item.quantity);
  const unit = normalizeUnit(item.unit || '');
  const name = String(item.name || item.display || '').trim();
  const pantryKey = item.pantryKey ? normalizeIngredient(item.pantryKey) : inferPantryKey(name, ingredientNames);
  const trackPantry = Boolean(pantryKey) && Number.isFinite(quantity);

  return {
    id: `${recipe.id}-${index}-${slugify(name || item.display || 'item')}`,
    kind: trackPantry ? 'structured' : 'display',
    quantity: Number.isFinite(quantity) ? quantity : null,
    unit,
    name,
    display: item.display || formatIngredientLine({
      quantity: Number.isFinite(quantity) ? quantity : null,
      unit,
      name,
    }),
    pantryKey,
    trackPantry,
  };
}

function parseIngredientLine(line) {
  const raw = String(line || '').trim();
  if (!raw) return null;
  if (!/^\d/.test(raw)) return null;

  const match = raw.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)\s*(.*)$/);
  if (!match) return null;

  const quantity = parseNumber(match[1]);
  if (!Number.isFinite(quantity)) return null;

  let remainder = (match[2] || '').trim();
  if (!remainder) return null;

  const tokens = remainder.split(/\s+/);
  let unit = '';
  if (tokens.length) {
    const maybeUnit = normalizeUnit(tokens[0]);
    if (
      maybeUnit !== 'count'
      || /^(small|medium|large|lb|lbs|oz|ounce|ounces|cup|cups|tbsp|tablespoons?|tsp|teaspoons?|clove|cloves|can|cans|package|packages|packet|packets|slice|slices|bunch|bunches)$/i.test(tokens[0])
    ) {
      unit = maybeUnit;
      remainder = tokens.slice(1).join(' ').trim();
    }
  }

  if (!remainder) return null;
  return { quantity, unit, name: remainder };
}

function inferPantryKey(text, ingredientNames = []) {
  const normalizedText = normalizeIngredient(text);
  if (!normalizedText) return '';

  const recipeCandidates = ingredientNames
    .map(name => ({ source: name, normalized: normalizeIngredient(name) }))
    .filter(item => item.normalized);

  const siteCandidates = CATEGORY_KEYS.flatMap(category => (
    (siteConfig.ingredients?.[category] || []).map(item => ({
      source: item.name,
      normalized: normalizeIngredient(item.name),
    }))
  ));

  const allCandidates = [...recipeCandidates, ...siteCandidates];
  let best = null;

  allCandidates.forEach(candidate => {
    const score = scoreCandidateMatch(normalizedText, candidate.normalized);
    if (!score) return;
    if (!best || score > best.score || (score === best.score && candidate.normalized.length > best.normalized.length)) {
      best = { ...candidate, score };
    }
  });

  return best?.normalized || '';
}

function scoreCandidateMatch(text, candidate) {
  if (!text || !candidate) return 0;
  if (text === candidate) return 100;
  if (text.includes(candidate)) return 90 + candidate.length / 100;
  if (candidate.includes(text)) return 60 + text.length / 100;

  const textTokens = new Set(text.split(' '));
  const candidateTokens = candidate.split(' ');
  const overlap = candidateTokens.filter(token => textTokens.has(token));
  if (!overlap.length) return 0;

  return overlap.length * 10 + (overlap.join(' ').length / Math.max(candidate.length, 1));
}

function enrichIngredientProfiles() {
  const unitCounts = {};

  recipes.forEach(recipe => {
    (recipe.pantryTrackableItems || []).forEach(item => {
      if (!item.pantryKey) return;
      if (!unitCounts[item.pantryKey]) unitCounts[item.pantryKey] = {};
      unitCounts[item.pantryKey][item.unit] = (unitCounts[item.pantryKey][item.unit] || 0) + 1;
    });
  });

  CATEGORY_KEYS.forEach(category => {
    (siteConfig.ingredients?.[category] || []).forEach(item => {
      const key = normalizeIngredient(item.name);
      const counts = unitCounts[key] || {};
      const preferredUnit = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      item.pantryUnit = item.pantryUnit || preferredUnit || defaultUnitForCategory(category);
    });
  });
}

function defaultUnitForCategory(category) {
  if (category === 'meats') return 'lb';
  if (category === 'veggies') return 'count';
  if (category === 'grains') return 'cup';
  if (category === 'dairy') return 'cup';
  if (category === 'spices') return 'tsp';
  if (category === 'sauces') return 'tbsp';
  if (category === 'bakery') return 'count';
  if (category === 'pantry') return 'count';
  return 'count';
}

function buildSiteConfig(defaults, stored, ingredientCatalog = {}) {
  const merged = structuredClone(defaults);
  merged.ingredients = {};

  if (stored?.branding) {
    merged.branding.title = stored.branding.title || merged.branding.title;
    merged.branding.tagline = stored.branding.tagline || merged.branding.tagline;
  }

  CATEGORY_KEYS.forEach(category => {
    const defaultList = Array.isArray(ingredientCatalog?.[category])
      ? ingredientCatalog[category]
      : (Array.isArray(defaults.ingredients?.[category]) ? defaults.ingredients[category] : []);
    const storedList = Array.isArray(stored?.ingredients?.[category]) ? stored.ingredients[category] : null;

    merged.ingredients[category] = (storedList || defaultList).map(item => ({
      id: item.id || slugify(item.name),
      name: item.name,
      pantryUnit: item.pantryUnit || item.unit || '',
    }));
  });

  return merged;
}

function readStoredSiteConfig() {
  return readJson(STORAGE_KEYS.site, null);
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function migratePantryStore(store) {
  const next = {};
  Object.entries(store || {}).forEach(([key, value]) => {
    if (typeof value === 'number') next[key] = value;
    else if (value && typeof value.amount === 'number') next[key] = value.amount;
  });
  return next;
}

function migrateGroceryStore(store) {
  const items = Array.isArray(store) ? store : [];
  return items.map(item => {
    if (item && item.kind) return item;
    if (item && item.text) {
      return {
        kind: 'manual',
        text: item.text,
        recipeIds: item.recipeId ? [item.recipeId] : [],
        recipeNames: item.recipeName ? [item.recipeName] : [],
      };
    }
    return null;
  }).filter(Boolean);
}

function migrateMealPlanStore(store) {
  const items = Array.isArray(store) ? store : [];
  return items
    .map(item => ({
      recipeId: item.recipeId,
      servings: Number(item.servings) || 0,
    }))
    .filter(item => item.recipeId);
}

function persistSiteConfig() {
  localStorage.setItem(STORAGE_KEYS.site, JSON.stringify({
    branding: siteConfig.branding,
    ingredients: siteConfig.ingredients,
  }));
}

function persistPantry() {
  localStorage.setItem(STORAGE_KEYS.pantry, JSON.stringify(pantryCounts));
  queueSaveUserPantry();
}

function persistGrocery() {
  localStorage.setItem(STORAGE_KEYS.grocery, JSON.stringify(groceryItems));
  queueSaveUserGrocery();
}

function persistMealPlan() {
  localStorage.setItem(STORAGE_KEYS.mealPlan, JSON.stringify(mealPlan));
  queueSaveUserMealPlan();
}

function applyBranding() {
  if (el.appTitle) el.appTitle.textContent = siteConfig.branding.title;
  if (el.appTagline) el.appTagline.textContent = siteConfig.branding.tagline;
}

function applyTheme(themeId) {
  document.body.className = '';
  if (themeId && themeId !== 'citrus') {
    document.body.classList.add(`theme-${themeId}`);
  }
  currentTheme = themeId;
  localStorage.setItem(STORAGE_KEYS.theme, themeId);
  queueSaveUserPreferences();
}

function getThemeSwatches(themeId) {
  const paletteMap = {
    citrus: ['#ef6c57', '#ffb703', '#5bb9a8', '#fff6ef'],
    garden: ['#21a37b', '#7dcf8c', '#89d5c4', '#f1fbf6'],
    berry: ['#d94f87', '#ff9f68', '#7d5cff', '#fff2f7'],
    farmhouse: ['#b56f4d', '#d2a768', '#91b39d', '#fbf4e9'],
    diner: ['#ff5e6c', '#2fc4b2', '#5b7cfa', '#f6fffd'],
    lemon: ['#9ab63a', '#f2c94c', '#79a8d8', '#fffbe8'],
    copper: ['#c97745', '#e0b05d', '#7bb0aa', '#1d1d20'],
    midnight: ['#ff7f66', '#ffcd57', '#68d2bf', '#151827'],
  };
  return paletteMap[themeId] || paletteMap.citrus;
}

function renderAll() {
  renderIngredientChips();
  renderRecipes();
  renderGroceryList();
  renderMealPlan();
  renderSettingsForm();
  renderSectionState();
}

function persistSectionState() {
  localStorage.setItem(STORAGE_KEYS.sections, JSON.stringify(sectionState));
  queueSaveUserPreferences();
}

function toggleSection(sectionKey) {
  sectionState[sectionKey] = !sectionState[sectionKey];
  persistSectionState();
  renderSectionState();
}

function renderSectionState() {
  const layout = document.querySelector('.layout');

  document.querySelectorAll('[data-section]').forEach(section => {
    const key = section.dataset.section;
    const collapsed = Boolean(sectionState[key]);
    section.classList.toggle('collapsed', collapsed);
    section.classList.toggle('expanded', !collapsed);
  });

  if (layout) {
    layout.classList.toggle('recipes-collapsed', Boolean(sectionState.recipes));
  }

  document.querySelectorAll('[data-toggle-section]').forEach(btn => {
    const key = btn.dataset.toggleSection;
    const collapsed = Boolean(sectionState[key]);
    const labelMap = {
      recipes: 'recipes',
      ingredients: 'ingredients',
      shopping: 'grocery list',
      'meal-plan': 'meal plan',
    };
    const sectionLabel = labelMap[key] || 'section';
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${sectionLabel}`);
    btn.setAttribute('title', `${collapsed ? 'Expand' : 'Collapse'} ${sectionLabel}`);
  });

  document.querySelectorAll('[data-ingredient-category]').forEach(section => {
    const categoryKey = section.dataset.ingredientCategory;
    const collapsed = Boolean(sectionState[`ingredients-${categoryKey}`]);
    section.classList.toggle('collapsed', collapsed);
    section.classList.toggle('expanded', !collapsed);
  });

  document.querySelectorAll('[data-toggle-ingredient-category]').forEach(btn => {
    const categoryKey = btn.dataset.toggleIngredientCategory;
    const collapsed = Boolean(sectionState[`ingredients-${categoryKey}`]);
    const categoryLabel = CATEGORY_DEFS.find(item => item.key === categoryKey)?.label || categoryKey;
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${categoryLabel}`);
    btn.setAttribute('title', `${collapsed ? 'Expand' : 'Collapse'} ${categoryLabel}`);
  });
}

function renderIngredientChips() {
  if (!el.ingredientCategories) return;
  el.ingredientCategories.innerHTML = '';

  CATEGORY_DEFS.forEach(category => {
    const section = document.createElement('section');
    const sectionKey = `ingredients-${category.key}`;
    const collapsed = Boolean(sectionState[sectionKey]);
    section.className = `chip-block nested-chip-block ingredient-category-section${collapsed ? ' collapsed' : ' expanded'}`;
    section.dataset.ingredientCategory = category.key;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ingredient-category-toggle';
    toggle.dataset.toggleIngredientCategory = category.key;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${category.label}`);
    toggle.innerHTML = `
      <span class="ingredient-category-toggle-circle" aria-hidden="true"></span>
      <span class="ingredient-category-title">${escapeHtml(category.label)}</span>
    `;
    section.appendChild(toggle);

    const body = document.createElement('div');
    body.className = 'ingredient-category-body';

    const meta = document.createElement('div');
    meta.className = 'ingredient-category-meta';
    meta.innerHTML = `<p>${escapeHtml(category.description)}</p>`;
    body.appendChild(meta);

    const grid = document.createElement('div');
    grid.className = 'chip-grid';
    renderChipGroup(category.key, grid);
    body.appendChild(grid);

    section.appendChild(body);
    el.ingredientCategories.appendChild(section);
  });
}

function renderChipGroup(category, container) {
  const items = siteConfig.ingredients?.[category] || [];
  container.innerHTML = '';

  if (!items.length) {
    container.innerHTML = '<div class="empty-state small-empty">No ingredients added yet.</div>';
    return;
  }

  const hint = document.createElement('div');
  hint.className = 'settings-help';
  hint.textContent = 'Tap to cycle quantity. Counts should match the unit hint when possible.';
  container.appendChild(hint);

  const sortedItems = [...items].sort((a, b) => {
    const aQty = pantryCounts[normalizeIngredient(a.name)] || 0;
    const bQty = pantryCounts[normalizeIngredient(b.name)] || 0;
    const aHave = aQty > 0;
    const bHave = bQty > 0;
    if (aHave !== bHave) return aHave ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const haveItems = sortedItems.filter(item => (pantryCounts[normalizeIngredient(item.name)] || 0) > 0);
  const needItems = sortedItems.filter(item => (pantryCounts[normalizeIngredient(item.name)] || 0) <= 0);

  const createChipButton = (item) => {
    const key = normalizeIngredient(item.name);
    const qty = pantryCounts[key] || 0;
    const unitHint = item.pantryUnit ? ` • ${item.pantryUnit}` : '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip${qty > 0 ? ' active' : ''}`;
    btn.textContent = qty > 0 ? `${item.name} (${formatAmount(qty)}${unitHint})` : `${item.name}${unitHint}`;

    btn.addEventListener('click', () => {
      const nextQty = qty >= 9 ? 0 : qty + 1;
      if (nextQty === 0) delete pantryCounts[key];
      else pantryCounts[key] = nextQty;
      persistPantry();
      currentPage = 1;
      renderAll();
    });

    return btn;
  };

  const appendGroup = (label, groupItems, extraClass = '') => {
    if (!groupItems.length) return;

    const group = document.createElement('div');
    group.className = `ingredient-chip-group ${extraClass}`.trim();

    const title = document.createElement('div');
    title.className = 'ingredient-chip-group-title';
    title.textContent = label;
    group.appendChild(title);

    const groupGrid = document.createElement('div');
    groupGrid.className = 'chip-grid ingredient-chip-grid';
    groupItems.forEach(item => groupGrid.appendChild(createChipButton(item)));
    group.appendChild(groupGrid);

    container.appendChild(group);
  };

  appendGroup('Have', haveItems);

  if (haveItems.length && needItems.length) {
    const divider = document.createElement('div');
    divider.className = 'ingredient-chip-divider';
    container.appendChild(divider);
  }

  appendGroup('Need / Available', needItems, 'is-need-group');
}

function getScoredRecipes() {
  return recipes
    .map(recipe => scoreRecipe(recipe))
    .sort((a, b) => {
      if (b.haveAll !== a.haveAll) return Number(b.haveAll) - Number(a.haveAll);
      if (b.coveragePct !== a.coveragePct) return b.coveragePct - a.coveragePct;
      if (a.totalMissingAmount !== b.totalMissingAmount) return a.totalMissingAmount - b.totalMissingAmount;
      return a.recipe.name.localeCompare(b.recipe.name);
    });
}

function scoreRecipe(recipe, servings = recipe.servings) {
  const scale = (Number(servings) || recipe.servings || 4) / (recipe.servings || 4);
  const shortages = (recipe.pantryTrackableItems || []).map(item => getItemShortage(item, scale));

  const trackedCount = shortages.length;
  const coveredCount = shortages.filter(item => item.missing <= 0).length;
  const partialCount = shortages.filter(item => item.have > 0 && item.missing > 0).length;
  const missingCount = shortages.filter(item => item.missing > 0).length;
  const totalMissingAmount = shortages.reduce((sum, item) => sum + item.missing, 0);
  const haveAll = trackedCount > 0 && missingCount === 0;
  const coveragePct = trackedCount ? coveredCount / trackedCount : 0;

  return {
    recipe,
    totalCount: trackedCount,
    matchedCount: coveredCount,
    partialCount,
    missingCount,
    haveAll,
    coveragePct,
    totalMissingAmount,
    shortages,
  };
}

function renderRecipes() {
  const allScoredRecipes = getScoredRecipes();
  const scoredRecipes = activeRecipeFile === 'all'
    ? allScoredRecipes
    : allScoredRecipes.filter(({ recipe }) => recipe.sourceFile === activeRecipeFile);

  const total = scoredRecipes.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);

  const activeFilterLabel = activeRecipeFile === 'all'
    ? 'All recipe files'
    : (recipeFileOptions.find(option => option.value === activeRecipeFile)?.label || 'Filtered recipes');

  if (el.resultsCount) {
    el.resultsCount.textContent = `${total} recipe${total === 1 ? '' : 's'} • ${activeFilterLabel}`;
  }

  const selectedCount = Object.values(pantryCounts).filter(count => count > 0).length;
  if (el.matchSummary) {
    el.matchSummary.textContent = selectedCount
      ? `You marked ${selectedCount} ingredient${selectedCount === 1 ? '' : 's'} on hand. Cards now score by quantity coverage, not just yes or no.`
      : 'Pick ingredients on the right to prioritize recipes and estimate what you are short for each one.';
  }

  if (!el.recipeList) return;
  const pageItems = scoredRecipes.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  el.recipeList.innerHTML = '';

  if (!pageItems.length) {
    el.recipeList.innerHTML = '<div class="empty-state">No recipes found.</div>';
    renderPagination(totalPages);
    return;
  }

  pageItems.forEach(({ recipe, matchedCount, totalCount, missingCount, partialCount, haveAll, shortages }) => {
    const card = document.createElement('article');
    card.className = 'recipe-card';

    const titleRow = document.createElement('div');
    titleRow.className = 'recipe-title-row';

    const totalShort = shortages.reduce((sum, item) => sum + item.missing, 0);
    const inPlan = isRecipePlanned(recipe.id);

    titleRow.innerHTML = `
      <div>
        <h3>${escapeHtml(recipe.name)}</h3>
      </div>
      <div class="meta-tags">
        ${haveAll ? '<span class="have-it-pill">Have it</span>' : ''}
        ${partialCount ? `<span class="ready-pill manual">Partial ${partialCount}</span>` : ''}
        <span class="score-pill">Covered ${matchedCount}/${totalCount || 0}</span>
        ${missingCount ? `<span class="missing-pill">Short ${formatAmount(totalShort)}</span>` : ''}
        ${inPlan ? '<span class="list-count-pill">Planned</span>' : ''}
      </div>
    `;

    const meta = document.createElement('div');
    meta.className = 'recipe-meta';
    meta.innerHTML = `
      <span class="meta-tag">${escapeHtml(recipe.time || '—')}</span>
      <span class="meta-tag">${escapeHtml(recipe.difficulty || '—')}</span>
      <span class="meta-tag">Serves ${Number(recipe.servings) || 4}</span>
      <span class="meta-tag">${escapeHtml(recipe.sourceLabel || 'Recipes')}</span>
    `;

    const desc = document.createElement('p');
    desc.className = 'recipe-desc';
    desc.textContent = recipe.description || 'No description available.';

    const actions = document.createElement('div');
    actions.className = 'recipe-actions';

    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'recipe-btn';
    viewBtn.textContent = 'View recipe';
    viewBtn.addEventListener('click', () => openRecipeModal(recipe));

    const planBtn = document.createElement('button');
    planBtn.type = 'button';
    planBtn.className = `${inPlan ? 'ghost-btn is-added-btn' : 'ghost-btn'} small-btn`;
    planBtn.textContent = inPlan ? 'Planned' : 'Plan meal';
    planBtn.addEventListener('click', () => {
      toggleMealPlanRecipe(recipe.id, recipe.servings);
    });

    actions.append(viewBtn, planBtn);
    card.append(titleRow, meta, desc, actions);
    el.recipeList.appendChild(card);
  });

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  if (!el.recipePagination) return;

  el.recipePagination.innerHTML = '';
  if (totalPages <= 1) {
    el.recipePagination.classList.remove('active');
    return;
  }

  el.recipePagination.classList.add('active');

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'ghost-btn small-btn';
  prev.textContent = 'Previous';
  prev.disabled = currentPage === 1;
  prev.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage -= 1;
      renderRecipes();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  const pages = document.createElement('div');
  pages.className = 'pagination-pages';
  for (let page = 1; page <= totalPages; page += 1) {
    const pageBtn = document.createElement('button');
    pageBtn.type = 'button';
    pageBtn.className = `page-btn${page === currentPage ? ' active' : ''}`;
    pageBtn.textContent = String(page);
    pageBtn.addEventListener('click', () => {
      currentPage = page;
      renderRecipes();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    pages.appendChild(pageBtn);
  }

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'ghost-btn small-btn';
  next.textContent = 'Next';
  next.disabled = currentPage === totalPages;
  next.addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage += 1;
      renderRecipes();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  el.recipePagination.append(prev, pages, next);
}

function openRecipeModal(recipe) {
  activeRecipe = recipe;
  const planned = mealPlan.find(item => item.recipeId === recipe.id);
  activeRecipeServings = planned?.servings || Number(recipe.servings) || 4;
  el.recipeModal.classList.remove('hidden');
  el.recipeModal.setAttribute('aria-hidden', 'false');
  setRecipeModalTab('grocery');
  renderRecipeModal();
}

function closeRecipeModal() {
  if (!el.recipeModal) return;
  el.recipeModal.classList.add('hidden');
  el.recipeModal.setAttribute('aria-hidden', 'true');
}

function setRecipeModalTab(tabName) {
  document.querySelectorAll('.modal-tabs .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  if (el.tabGrocery) el.tabGrocery.classList.toggle('active', tabName === 'grocery');
  if (el.tabDirections) el.tabDirections.classList.toggle('active', tabName === 'directions');
}

function renderRecipeModal() {
  if (!activeRecipe || !el.modalTitle || !el.modalMeta || !el.tabGrocery || !el.tabDirections) return;

  el.modalTitle.textContent = activeRecipe.name;
  el.modalMeta.innerHTML = `
    <div class="recipe-meta">
      <span class="meta-tag">${escapeHtml(activeRecipe.time || '—')}</span>
      <span class="meta-tag">${escapeHtml(activeRecipe.difficulty || '—')}</span>
      <span class="meta-tag">Base serves ${Number(activeRecipe.servings) || 4}</span>
    </div>
  `;

  const baseServings = Number(activeRecipe.servings) || 4;
  const scale = activeRecipeServings / baseServings;

  el.tabGrocery.innerHTML = '';

  const servingsRow = document.createElement('div');
  servingsRow.className = 'servings-row';
  servingsRow.innerHTML = `
    <div>
      <strong>Serving size</strong>
      <div class="have-it-text">Base recipe serves ${baseServings}. Pantry and grocery math updates to match.</div>
    </div>
  `;

  const servingsSelect = document.createElement('select');
  servingsSelect.className = 'servings-select';
  for (let i = 1; i <= 12; i += 1) {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = String(i);
    option.selected = i === activeRecipeServings;
    servingsSelect.appendChild(option);
  }
  servingsSelect.addEventListener('change', () => {
    activeRecipeServings = Number(servingsSelect.value);
    const planEntry = mealPlan.find(item => item.recipeId === activeRecipe.id);
    if (planEntry) {
      planEntry.servings = activeRecipeServings;
      persistMealPlan();
      renderMealPlan();
      renderRecipes();
    }
    renderRecipeModal();
  });
  servingsRow.appendChild(servingsSelect);
  el.tabGrocery.appendChild(servingsRow);

  const tabActions = document.createElement('div');
  tabActions.className = 'tab-actions-row';

  const addAllBtn = document.createElement('button');
  addAllBtn.type = 'button';
  addAllBtn.className = 'primary-btn small-btn';
  addAllBtn.textContent = 'Add missing to grocery list';
  addAllBtn.addEventListener('click', () => addRecipeNeededItemsToGrocery(activeRecipe, scale));

  const inPlan = isRecipePlanned(activeRecipe.id);
  const planBtn = document.createElement('button');
  planBtn.type = 'button';
  planBtn.className = `${inPlan ? 'ghost-btn is-added-btn' : 'ghost-btn'} small-btn`;
  planBtn.textContent = inPlan ? 'Remove from meal plan' : 'Add to meal plan';
  planBtn.addEventListener('click', () => {
    toggleMealPlanRecipe(activeRecipe.id, activeRecipeServings);
    renderRecipeModal();
  });

  tabActions.append(addAllBtn, planBtn);
  el.tabGrocery.appendChild(tabActions);

 const list = document.createElement('ul');
list.className = 'action-ingredients-list';

const modalItems =
  (activeRecipe.groceryItems || []).some(item => item.trackPantry)
    ? (activeRecipe.groceryItems || [])
    : (activeRecipe.pantryTrackableItems || []);

modalItems.forEach((itemDef) => {
  const shortage = itemDef.trackPantry ? getItemShortage(itemDef, scale) : null;

  const item = document.createElement('li');

  const lineWrap = document.createElement('div');

  if (shortage) {
    const scaledText = formatIngredientLine({
      quantity: shortage.needed,
      unit: shortage.unit,
      name: itemDef.name,
    });

    const status =
      shortage.missing <= 0
        ? 'Have it'
        : shortage.have > 0
          ? `Need ${formatAmount(shortage.missing)} more`
          : `Need ${formatAmount(shortage.needed)}`;

    lineWrap.textContent = `${scaledText} — ${status}`;
  } else {
    lineWrap.textContent = itemDef.display || itemDef.name;
  }

  item.appendChild(lineWrap);
  list.appendChild(item);
});

  el.tabGrocery.appendChild(list);

  const directionsList = document.createElement('ol');
  directionsList.className = 'directions-list';
  (activeRecipe.directions || []).forEach(step => {
    const li = document.createElement('li');
    li.textContent = step;
    directionsList.appendChild(li);
  });
  el.tabDirections.innerHTML = '';
  el.tabDirections.appendChild(directionsList);
}

function getItemShortage(item, scale = 1, remainingPool = null) {
  const needed = roundAmount((Number(item.quantity) || 0) * scale);
  const source = remainingPool || pantryCounts;
  const have = Number(source[normalizeIngredient(item.pantryKey)] || 0);
  const missing = roundAmount(Math.max(0, needed - have));
  return {
    pantryKey: item.pantryKey,
    name: item.name,
    unit: item.unit || 'count',
    needed,
    have,
    missing,
    covered: missing <= 0,
  };
}

function addStructuredGroceryItem(recipe, shortage) {
  if (!shortage || shortage.missing <= 0) return;

  const existing = groceryItems.find(entry =>
    entry.kind === 'structured'
    && entry.pantryKey === shortage.pantryKey
    && normalizeUnit(entry.unit) === normalizeUnit(shortage.unit)
  );

  if (existing) {
    existing.quantity = roundAmount(existing.quantity + shortage.missing);
    existing.recipeIds = uniqueArray([...(existing.recipeIds || []), recipe.id]);
    existing.recipeNames = uniqueArray([...(existing.recipeNames || []), recipe.name]);
  } else {
    groceryItems.push({
      kind: 'structured',
      pantryKey: shortage.pantryKey,
      name: shortage.name,
      quantity: shortage.missing,
      unit: normalizeUnit(shortage.unit),
      recipeIds: [recipe.id],
      recipeNames: [recipe.name],
    });
  }

  persistGrocery();
}

function addManualGroceryItem(recipe, text) {
  const existing = groceryItems.find(entry => entry.kind === 'manual' && entry.text === text);
  if (existing) {
    existing.recipeIds = uniqueArray([...(existing.recipeIds || []), recipe.id]);
    existing.recipeNames = uniqueArray([...(existing.recipeNames || []), recipe.name]);
  } else {
    groceryItems.push({
      kind: 'manual',
      text,
      recipeIds: [recipe.id],
      recipeNames: [recipe.name],
    });
  }
  persistGrocery();
}

function addRecipeNeededItemsToGrocery(recipe, scale = 1) {
  let addedAnyItems = false;

  (recipe.groceryItems || []).forEach(item => {
    if (item.trackPantry) {
      const shortage = getItemShortage(item, scale);
      if (shortage.missing > 0) {
        addStructuredGroceryItem(recipe, shortage);
        addedAnyItems = true;
      }
    } else {
      addManualGroceryItem(recipe, item.display || item.name);
      addedAnyItems = true;
    }
  });

  if (addedAnyItems && !isRecipePlanned(recipe.id)) {
    mealPlan.push({ recipeId: recipe.id, servings: Math.max(1, Math.round(activeRecipeServings || recipe.servings || 4)) });
    persistMealPlan();
    renderMealPlan();
    renderRecipes();
  }

  persistGrocery();
  renderGroceryList();
  if (activeRecipe) renderRecipeModal();
}

function renderGroceryList() {
  if (!el.groceryList || !el.groceryRecipeSummary) return;

  el.groceryList.innerHTML = '';
  const recipeNames = [...new Set(groceryItems.flatMap(item => item.recipeNames || []))];
  el.groceryRecipeSummary.textContent = groceryItems.length
    ? `${groceryItems.length} line${groceryItems.length === 1 ? '' : 's'} from ${recipeNames.length} recipe${recipeNames.length === 1 ? '' : 's'}. Structured items merge automatically by ingredient.`
    : 'No grocery items added yet.';

  if (!groceryItems.length) {
    el.groceryList.innerHTML = '<div class="empty-state small-empty">Your grocery list is empty.</div>';
    return;
  }

  const list = document.createElement('ul');
  list.className = 'shopping-list';

  groceryItems.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'shopping-item';

    const left = document.createElement('div');
    left.className = 'shopping-text';

    if (item.kind === 'structured') {
      left.innerHTML = `
        <strong>${escapeHtml(formatIngredientLine(item))}</strong>
        <div class="settings-help">${escapeHtml((item.recipeNames || []).join(', '))}</div>
      `;
    } else {
      left.innerHTML = `
        <strong>${escapeHtml(item.text)}</strong>
        <div class="settings-help">${escapeHtml((item.recipeNames || []).join(', '))}</div>
      `;
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'ghost-btn small-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      groceryItems.splice(index, 1);
      persistGrocery();
      renderGroceryList();
      if (activeRecipe) renderRecipeModal();
    });

    li.append(left, removeBtn);
    list.appendChild(li);
  });

  el.groceryList.appendChild(list);
}

async function copyShoppingList() {
  const lines = groceryItems.length
    ? groceryItems.map(item => {
      if (item.kind === 'structured') return `• ${formatIngredientLine(item)} (${(item.recipeNames || []).join(', ')})`;
      return `• ${item.text} (${(item.recipeNames || []).join(', ')})`;
    })
    : ['No grocery items added yet.'];

  try {
    await navigator.clipboard.writeText(lines.join('\n'));
  } catch {
    // ignore clipboard failures
  }
}

function toggleMealPlanRecipe(recipeId, servings) {
  const existingIndex = mealPlan.findIndex(item => item.recipeId === recipeId);
  if (existingIndex >= 0) {
    mealPlan.splice(existingIndex, 1);
  } else {
    mealPlan.push({ recipeId, servings: Number(servings) || findRecipeById(recipeId)?.servings || 4 });
  }
  persistMealPlan();
  renderMealPlan();
  renderRecipes();
}

function isRecipePlanned(recipeId) {
  return mealPlan.some(item => item.recipeId === recipeId);
}

function findRecipeById(recipeId) {
  return recipes.find(recipe => recipe.id === recipeId) || null;
}

function buildMealPlanShortages() {
  const remaining = { ...pantryCounts };
  const shortages = {};
  const planRecipes = [];

  mealPlan.forEach(planItem => {
    const recipe = findRecipeById(planItem.recipeId);
    if (!recipe) return;

    const scale = (Number(planItem.servings) || recipe.servings || 4) / (recipe.servings || 4);
    planRecipes.push({ recipe, servings: Number(planItem.servings) || recipe.servings || 4 });

    (recipe.pantryTrackableItems || []).forEach(item => {
      const key = normalizeIngredient(item.pantryKey);
      const needed = roundAmount((Number(item.quantity) || 0) * scale);
      const available = Number(remaining[key] || 0);
      const used = Math.min(available, needed);
      const missing = roundAmount(Math.max(0, needed - available));

      remaining[key] = roundAmount(Math.max(0, available - needed));

      if (missing > 0) {
        if (!shortages[key]) {
          shortages[key] = {
            kind: 'structured',
            pantryKey: item.pantryKey,
            name: item.name,
            quantity: 0,
            unit: item.unit || 'count',
            recipeNames: [],
          };
        }
        shortages[key].quantity = roundAmount(shortages[key].quantity + missing);
        shortages[key].recipeNames = uniqueArray([...shortages[key].recipeNames, recipe.name]);
      }

      if (!shortages[`__usage__${recipe.id}`]) shortages[`__usage__${recipe.id}`] = [];
      shortages[`__usage__${recipe.id}`].push({
        pantryKey: key,
        name: item.name,
        unit: item.unit || 'count',
        needed,
        used,
        missing,
      });
    });
  });

  return {
    missingItems: Object.values(shortages).filter(item => item && item.kind === 'structured'),
    usageByRecipe: shortages,
    remaining,
    planRecipes,
  };
}

function renderMealPlan() {
  if (!el.mealPlanList || !el.mealPlanSummary || !el.mealPlanShopping) return;

  el.mealPlanList.innerHTML = '';
  el.mealPlanShopping.innerHTML = '';

  const summary = buildMealPlanShortages();
  el.mealPlanSummary.textContent = mealPlan.length
    ? `${mealPlan.length} meal${mealPlan.length === 1 ? '' : 's'} planned. Shortages are calculated against one shared pantry pool.`
    : 'No meals planned yet. Add recipes to see true week-level shortages.';

  if (!mealPlan.length) {
    el.mealPlanList.innerHTML = '<div class="empty-state small-empty">Plan recipes from a card or from the recipe modal.</div>';
    el.mealPlanShopping.innerHTML = '<div class="empty-state small-empty">Plan shortages will show up here.</div>';
    return;
  }

  const planList = document.createElement('ul');
  planList.className = 'shopping-list';

  mealPlan.forEach((planItem, index) => {
    const recipe = findRecipeById(planItem.recipeId);
    if (!recipe) return;

    const li = document.createElement('li');
    li.className = 'shopping-item';

    const left = document.createElement('div');
    left.className = 'shopping-text';
    left.innerHTML = `<strong>${escapeHtml(recipe.name)}</strong><div class="settings-help">Planned for ${escapeHtml(String(planItem.servings))} serving${planItem.servings === 1 ? '' : 's'}</div>`;

    const right = document.createElement('div');
    right.className = 'meal-plan-actions';

    const select = document.createElement('select');
    select.className = 'servings-select';
    for (let i = 1; i <= 12; i += 1) {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = `${i} servings`;
      option.selected = i === planItem.servings;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      mealPlan[index].servings = Number(select.value);
      persistMealPlan();
      renderMealPlan();
      renderRecipes();
      if (activeRecipe?.id === recipe.id) {
        activeRecipeServings = Number(select.value);
        renderRecipeModal();
      }
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'ghost-btn small-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      mealPlan.splice(index, 1);
      persistMealPlan();
      renderMealPlan();
      renderRecipes();
      if (activeRecipe?.id === recipe.id) renderRecipeModal();
    });

    right.append(select, removeBtn);
    li.append(left, right);
    planList.appendChild(li);
  });

  el.mealPlanList.appendChild(planList);

  if (!summary.missingItems.length) {
    el.mealPlanShopping.innerHTML = '<div class="empty-state small-empty">Your current pantry covers the planned meals.</div>';
    return;
  }

  const shortageList = document.createElement('ul');
  shortageList.className = 'shopping-list';

  summary.missingItems.forEach(item => {
    const li = document.createElement('li');
    li.className = 'shopping-item';

    const left = document.createElement('div');
    left.className = 'shopping-text';
    left.innerHTML = `<strong>${escapeHtml(formatIngredientLine(item))}</strong><div class="settings-help">${escapeHtml(item.recipeNames.join(', '))}</div>`;

    li.append(left);
    shortageList.appendChild(li);
  });

  el.mealPlanShopping.appendChild(shortageList);
}

function addMealPlanShortagesToGrocery() {
  const summary = buildMealPlanShortages();
  summary.missingItems.forEach(item => {
    const matchingEntries = groceryItems.filter(entry =>
      entry.kind === 'structured'
      && entry.pantryKey === item.pantryKey
      && normalizeUnit(entry.unit) === normalizeUnit(item.unit)
    );

    const existingMealPlanEntry = matchingEntries.find(entry => entry.fromMealPlan);
    const existingManualEntry = matchingEntries.find(entry => !entry.fromMealPlan);

    if (existingMealPlanEntry) {
      existingMealPlanEntry.quantity = item.quantity;
      existingMealPlanEntry.recipeNames = item.recipeNames || [];
      existingMealPlanEntry.recipeIds = mealPlan.map(p => p.recipeId);
    } else if (existingManualEntry) {
      existingManualEntry.quantity = roundAmount(existingManualEntry.quantity + item.quantity);
      existingManualEntry.recipeNames = uniqueArray([...(existingManualEntry.recipeNames || []), ...(item.recipeNames || [])]);
      existingManualEntry.recipeIds = uniqueArray([...(existingManualEntry.recipeIds || []), ...mealPlan.map(p => p.recipeId)]);
    } else {
      groceryItems.push({
        ...item,
        recipeNames: item.recipeNames || [],
        recipeIds: mealPlan.map(p => p.recipeId),
        fromMealPlan: true,
      });
    }
  });

  persistGrocery();
  renderGroceryList();
}

function openSettingsModal() {
  if (!canEditSharedData()) {
    if (!currentUser) {
      openLoginModal('Sign in as an editor or admin to access settings.');
    } else {
      setAccountMessage('Your account can use pantry, grocery list, and meal plan, but shared cookbook settings are read-only.', false);
    }
    return;
  }
  renderSettingsForm();
  if (!el.settingsModal) return;
  el.settingsModal.classList.remove('hidden');
  el.settingsModal.setAttribute('aria-hidden', 'false');
  setSettingsTab('general');
}

function closeSettingsModal() {
  if (!el.settingsModal) return;
  el.settingsModal.classList.add('hidden');
  el.settingsModal.setAttribute('aria-hidden', 'true');
}

function setSettingsTab(tabName) {
  document.querySelectorAll('.settings-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.settingsTab === tabName);
  });
  document.querySelectorAll('.settings-page').forEach(page => {
    page.classList.toggle('active', page.dataset.settingsPage === tabName);
  });
}

function renderSettingsForm() {
  if (el.titleInput) el.titleInput.value = siteConfig.branding.title || '';
  if (el.taglineInput) el.taglineInput.value = siteConfig.branding.tagline || '';

  if (el.themeOptions) {
    el.themeOptions.innerHTML = '';
    (siteConfig.themes || []).forEach(theme => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `theme-btn${theme.id === currentTheme ? ' active' : ''}`;
      btn.innerHTML = `
        <span class="theme-name">${escapeHtml(theme.name)}</span>
        <span class="theme-swatches" aria-hidden="true">
          <span style="background:${getThemeSwatches(theme.id)[0]}"></span>
          <span style="background:${getThemeSwatches(theme.id)[1]}"></span>
          <span style="background:${getThemeSwatches(theme.id)[2]}"></span>
          <span style="background:${getThemeSwatches(theme.id)[3]}"></span>
        </span>
      `;
      btn.addEventListener('click', () => {
        applyTheme(theme.id);
        renderSettingsForm();
      });
      el.themeOptions.appendChild(btn);
    });
  }

  renderSettingsCategoryPages();
}

function renderSettingsCategoryPages() {
  if (!el.settingsNav || !el.settingsCategoryPages) return;

  el.settingsNav.innerHTML = '';
  el.settingsCategoryPages.innerHTML = '';

  CATEGORY_DEFS.forEach(category => {
    const navBtn = document.createElement('button');
    navBtn.type = 'button';
    navBtn.className = 'tab-btn settings-nav-btn';
    navBtn.dataset.settingsTab = category.key;
    navBtn.textContent = category.label;
    el.settingsNav.appendChild(navBtn);

    const page = document.createElement('section');
    page.className = 'settings-page';
    page.dataset.settingsPage = category.key;
    page.innerHTML = `
      <section class="settings-section ingredient-page-section">
        <div class="ingredient-admin-card single-admin-card">
          <div class="ingredient-admin-top">
            <div>
              <p class="section-label">Ingredients</p>
              <h3>Manage ${escapeHtml(category.label.toLowerCase())}</h3>
            </div>
            <p class="settings-help">Add, rename, or remove ${escapeHtml(category.label.toLowerCase())} chip options.</p>
          </div>
          <div class="inline-add-row wide-add-row">
            <input id="add-${category.key}-input" type="text" placeholder="${escapeHtml(category.placeholder)}" maxlength="40" />
            <button class="primary-btn small-btn" data-add-ingredient="${category.key}" type="button">Add</button>
          </div>
          <div id="manage-${category.key}" class="manage-list"></div>
        </div>
      </section>
    `;

    const categoryToggle = document.createElement('label');
    categoryToggle.className = 'settings-help';
    categoryToggle.style.display = 'block';
    categoryToggle.style.marginBottom = '10px';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(categoryStockDefaults[category.key]);
    checkbox.style.marginRight = '8px';

    checkbox.addEventListener('change', () => {
      setCategoryStockDefault(category.key, checkbox.checked);
    });

    categoryToggle.appendChild(checkbox);
    categoryToggle.append('Always stocked by default');

    page.querySelector('.ingredient-admin-top')?.appendChild(categoryToggle);

    el.settingsCategoryPages.appendChild(page);
    renderManageList(category.key, page.querySelector(`#manage-${category.key}`));
  });
}

function renderManageList(category, container) {
  if (!container) return;

  const items = siteConfig.ingredients?.[category] || [];
  container.innerHTML = '';

  if (!items.length) {
    container.innerHTML = '<div class="empty-state small-empty">No items yet.</div>';
    return;
  }

  items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'manage-row';

    const name = document.createElement('strong');
    name.textContent = item.pantryUnit ? `${item.name} • ${item.pantryUnit}` : item.name;

    const actions = document.createElement('div');
    actions.className = 'topbar-actions';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'ghost-btn small-btn';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => {
      const nextName = window.prompt(`Rename ${item.name}`, item.name)?.trim();
      if (!nextName) return;

      const oldKey = normalizeIngredient(item.name);
      const newKey = normalizeIngredient(nextName);

      siteConfig.ingredients[category][index] = { ...item, id: slugify(nextName), name: nextName };

      if (oldKey !== newKey && oldKey in pantryCounts) {
        pantryCounts[newKey] = pantryCounts[oldKey];
        delete pantryCounts[oldKey];
      }

      if (oldKey !== newKey && oldKey in ingredientStockOverrides) {
        ingredientStockOverrides[newKey] = ingredientStockOverrides[oldKey];
        delete ingredientStockOverrides[oldKey];
        persistStockSettings();
      }

      persistSiteConfig();
      persistPantry();
      saveSharedIngredient(siteConfig.ingredients[category][index], category)
        .then(() => refreshSharedCatalog())
        .catch(error => { console.error('Rename failed:', error); setAccountMessage('Rename failed.', true); });
      renderAll();
    });

    const unitBtn = document.createElement('button');
    unitBtn.type = 'button';
    unitBtn.className = 'ghost-btn small-btn';
    unitBtn.textContent = 'Unit';
    unitBtn.addEventListener('click', () => {
      const nextUnit = window.prompt(`Pantry unit hint for ${item.name}`, item.pantryUnit || defaultUnitForCategory(category))?.trim();
      if (!nextUnit) return;
      siteConfig.ingredients[category][index] = { ...item, pantryUnit: normalizeUnit(nextUnit) };
      persistSiteConfig();
      saveSharedIngredient(siteConfig.ingredients[category][index], category)
        .then(() => refreshSharedCatalog())
        .catch(error => { console.error('Unit update failed:', error); setAccountMessage('Unit update failed.', true); });
      renderAll();
    });

    const stockBtn = document.createElement('button');
    stockBtn.type = 'button';
    stockBtn.className = 'ghost-btn small-btn';

    const override = ingredientStockOverrides[normalizeIngredient(item.name)];
    stockBtn.textContent =
      override === 'always' ? 'Stock: Always'
        : override === 'never' ? 'Stock: Off'
          : 'Stock: Category';

    stockBtn.addEventListener('click', () => {
      cycleIngredientStockOverride(item.name);
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'ghost-btn small-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      const removed = siteConfig.ingredients[category].splice(index, 1)[0];
      if (removed) {
        delete pantryCounts[normalizeIngredient(removed.name)];
        delete ingredientStockOverrides[normalizeIngredient(removed.name)];
      }
      persistSiteConfig();
      persistPantry();
      persistStockSettings();
      deleteSharedIngredient(removed.name)
        .then(() => refreshSharedCatalog())
        .catch(error => { console.error('Remove failed:', error); setAccountMessage('Remove failed.', true); });
      renderAll();
    });

    actions.append(renameBtn, unitBtn, stockBtn, removeBtn);
    row.append(name, actions);
    container.appendChild(row);
  });
}

function addIngredient(category) {
  const input = document.getElementById(`add-${category}-input`);
  const value = input?.value?.trim();
  if (!value) return;

  const exists = (siteConfig.ingredients?.[category] || []).some(item => normalizeIngredient(item.name) === normalizeIngredient(value));
  if (exists) {
    input.value = '';
    return;
  }

  siteConfig.ingredients[category].push({
    id: slugify(value),
    name: toTitleCase(value),
    pantryUnit: defaultUnitForCategory(category),
  });

  siteConfig.ingredients[category].sort((a, b) => a.name.localeCompare(b.name));

  pantryCounts = applyStockDefaults(pantryCounts, siteConfig.ingredients);

  const createdItem = siteConfig.ingredients[category].find(item => normalizeIngredient(item.name) === normalizeIngredient(value));

  input.value = '';
  persistSiteConfig();
  persistPantry();
  if (createdItem && canEditSharedData()) {
    saveSharedIngredient(createdItem, category)
      .then(() => refreshSharedCatalog())
     .catch(error => {
  console.error('Add ingredient failed:', error);
  setAccountMessage(`Add ingredient failed: ${error?.message || 'Unknown error'}`, true);
});
  }
  renderAll();
}

async function saveSettings() {
  siteConfig.branding.title = el.titleInput?.value.trim() || 'What the !#$%&@ is for Dinner?';
  siteConfig.branding.tagline = el.taglineInput?.value.trim() || 'Tonight’s plan starts here';
  persistSiteConfig();

  if (canEditSharedData()) {
    const { error } = await window.supabaseClient.from('app_settings').upsert({
      id: 'global',
      title: siteConfig.branding.title,
      tagline: siteConfig.branding.tagline,
      default_theme: siteConfig.defaultTheme || 'citrus',
    });
    if (error) {
      console.error('Failed to save app settings:', error);
      setAccountMessage('Failed to save shared settings.', true);
      return;
    }
  }

  applyBranding();
  renderAll();
  closeSettingsModal();
}

function resetSettings() {
  localStorage.removeItem(STORAGE_KEYS.site);
  localStorage.removeItem(STORAGE_KEYS.theme);
  localStorage.removeItem(STORAGE_KEYS.pantry);
  localStorage.removeItem(STORAGE_KEYS.grocery);
  localStorage.removeItem(STORAGE_KEYS.mealPlan);
  localStorage.removeItem(STORAGE_KEYS.stockDefaults);
  localStorage.removeItem(STORAGE_KEYS.stockOverrides);

  categoryStockDefaults = { ...BASE_CATEGORY_DEFAULTS };
  ingredientStockOverrides = {};
  pantryCounts = {};
  groceryItems = [];
  mealPlan = [];

  loadAppDataFromSupabase()
    .then(({ ingredientCatalog, appSettings }) => {
      siteConfig = buildSiteConfig({
        ...APP_DEFAULTS,
        branding: {
          title: appSettings?.title || APP_DEFAULTS.branding.title,
          tagline: appSettings?.tagline || APP_DEFAULTS.branding.tagline,
        },
        defaultTheme: appSettings?.default_theme || APP_DEFAULTS.defaultTheme,
      }, null, ingredientCatalog);
      pantryCounts = applyStockDefaults({}, siteConfig.ingredients);
      persistPantry();
      enrichIngredientProfiles();
      applyTheme(siteConfig.defaultTheme || 'citrus');
      applyBranding();
      renderAll();
    })
    .catch(error => {
      console.error('Reset failed while loading Supabase data:', error);
    });
}

async function initializeAuth() {
  const supabaseClient = window.supabaseClient;
  if (!supabaseClient) return;

  const { data: { session } } = await supabaseClient.auth.getSession();
  await applyAuthSession(session);

  authSubscription?.subscription?.unsubscribe?.();
  const { data } = supabaseClient.auth.onAuthStateChange((_event, sessionUpdate) => {
    applyAuthSession(sessionUpdate).catch(error => console.error('Auth state refresh failed:', error));
  });
  authSubscription = data;
}

async function applyAuthSession(session) {
  currentSession = session || null;
  currentUser = session?.user || null;
  currentRoles = currentUser ? await fetchCurrentUserRoles() : [];

  if (currentUser) {
    await loadUserStateFromSupabase();
  } else {
    pantryCounts = migratePantryStore(readJson(STORAGE_KEYS.pantry, {}));
    groceryItems = migrateGroceryStore(readJson(STORAGE_KEYS.grocery, []));
    mealPlan = migrateMealPlanStore(readJson(STORAGE_KEYS.mealPlan, []));
    sectionState = { ...sectionState, ...(readJson(STORAGE_KEYS.sections, {}) || {}) };
    categoryStockDefaults = { ...BASE_CATEGORY_DEFAULTS, ...(readJson(STORAGE_KEYS.stockDefaults, {}) || {}) };
    ingredientStockOverrides = readJson(STORAGE_KEYS.stockOverrides, {}) || {};
    currentTheme = localStorage.getItem(STORAGE_KEYS.theme) || siteConfig.defaultTheme || 'citrus';
    applyTheme(currentTheme);
  }

  pantryCounts = applyStockDefaults(pantryCounts, siteConfig.ingredients);
  refreshAuthUi();
  renderAll();
}

async function fetchCurrentUserRoles() {
  const { data, error } = await window.supabaseClient.from('user_roles').select('role').eq('user_id', currentUser.id);
  if (error) {
    console.error('Failed to load roles:', error);
    return [];
  }
  return (data || []).map(item => item.role);
}

async function loadUserStateFromSupabase() {
  const [pantryResult, groceryResult, mealPlanResult, prefsResult] = await Promise.all([
    window.supabaseClient.from('user_pantry').select('pantry_key, quantity').order('pantry_key', { ascending: true }),
    window.supabaseClient.from('user_grocery_items').select('sort_order, item').order('sort_order', { ascending: true }),
    window.supabaseClient.from('user_meal_plan').select('sort_order, recipe_id, servings').order('sort_order', { ascending: true }),
    window.supabaseClient.from('user_ui_preferences').select('*').maybeSingle(),
  ]);

  if (pantryResult.error) console.error('Failed to load pantry:', pantryResult.error);
  if (groceryResult.error) console.error('Failed to load grocery list:', groceryResult.error);
  if (mealPlanResult.error) console.error('Failed to load meal plan:', mealPlanResult.error);
  if (prefsResult.error) console.error('Failed to load preferences:', prefsResult.error);

  pantryCounts = Object.fromEntries((pantryResult.data || []).map(row => [row.pantry_key, Number(row.quantity) || 0]));
  groceryItems = (groceryResult.data || []).map(row => row.item).filter(Boolean);
  mealPlan = (mealPlanResult.data || []).map(row => ({ recipeId: row.recipe_id, servings: Number(row.servings) || 4 }));

  const prefs = prefsResult.data || {};
  if (prefs.section_state && typeof prefs.section_state === 'object') sectionState = { ...sectionState, ...prefs.section_state };
  if (prefs.stock_defaults && typeof prefs.stock_defaults === 'object') categoryStockDefaults = { ...BASE_CATEGORY_DEFAULTS, ...prefs.stock_defaults };
  if (prefs.stock_overrides && typeof prefs.stock_overrides === 'object') ingredientStockOverrides = prefs.stock_overrides;
  if (prefs.theme) currentTheme = prefs.theme;

  localStorage.setItem(STORAGE_KEYS.pantry, JSON.stringify(pantryCounts));
  localStorage.setItem(STORAGE_KEYS.grocery, JSON.stringify(groceryItems));
  localStorage.setItem(STORAGE_KEYS.mealPlan, JSON.stringify(mealPlan));
  localStorage.setItem(STORAGE_KEYS.sections, JSON.stringify(sectionState));
  localStorage.setItem(STORAGE_KEYS.stockDefaults, JSON.stringify(categoryStockDefaults));
  localStorage.setItem(STORAGE_KEYS.stockOverrides, JSON.stringify(ingredientStockOverrides));
  if (currentTheme) localStorage.setItem(STORAGE_KEYS.theme, currentTheme);
  applyTheme(currentTheme || siteConfig.defaultTheme || 'citrus');
}

function canEditSharedData() {
  return currentRoles.includes('admin') || currentRoles.includes('editor');
}

function refreshAuthUi() {
  if (el.accountStatus) {
    const roleLabel = currentRoles.length ? ` (${currentRoles.join(', ')})` : '';
    el.accountStatus.textContent = currentUser ? `${currentUser.email}${roleLabel}` : 'Browsing recipes';
    el.accountStatus.classList.remove('account-error');
  }
  if (el.accountBtn) el.accountBtn.textContent = currentUser ? 'Account' : 'Log in';
  if (el.logoutBtn) el.logoutBtn.classList.toggle('hidden', !currentUser);
  if (document.getElementById('settings-btn')) {
    document.getElementById('settings-btn').classList.toggle('hidden', !canEditSharedData());
    document.getElementById('settings-btn').disabled = !canEditSharedData();
  }
}

function openLoginModal(message = '') {
  if (currentUser) {
    setAccountMessage(`Signed in as ${currentUser.email}.`, false);
    return;
  }
  if (el.loginMessage) {
    el.loginMessage.textContent = message;
    el.loginMessage.classList.remove('account-error');
  }
  el.loginModal?.classList.remove('hidden');
  el.loginModal?.setAttribute('aria-hidden', 'false');
}

function closeLoginModal() {
  el.loginModal?.classList.add('hidden');
  el.loginModal?.setAttribute('aria-hidden', 'true');
}

function setAccountMessage(message, isError = false) {
  if (el.accountStatus) {
    el.accountStatus.textContent = message;
    el.accountStatus.classList.toggle('account-error', Boolean(isError));
  }
  if (el.loginMessage) {
    el.loginMessage.textContent = message;
    el.loginMessage.classList.toggle('account-error', Boolean(isError));
  }
}

async function signInWithEmailPassword() {
  const email = el.loginEmail?.value?.trim();
  const password = el.loginPassword?.value || '';
  if (!email || !password) {
    setAccountMessage('Enter your email and password.', true);
    return;
  }
  const { error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    console.error('Login failed:', error);
    setAccountMessage(error.message || 'Login failed.', true);
    return;
  }
  closeLoginModal();
}

async function signOutCurrentUser() {
  const { error } = await window.supabaseClient.auth.signOut();
  if (error) {
    console.error('Logout failed:', error);
    setAccountMessage('Logout failed.', true);
  }
}

async function sendPasswordReset() {
  const email = el.loginEmail?.value?.trim();
  if (!email) {
    setAccountMessage('Enter your email address first.', true);
    return;
  }
  const redirectTo = `${window.location.origin}${window.location.pathname.replace(/[^/]+$/, '')}reset-password.html`;
  const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    console.error('Password reset failed:', error);
    setAccountMessage(error.message || 'Failed to send password reset.', true);
    return;
  }
  setAccountMessage('Password reset email sent.', false);
}

let pantrySavePromise = Promise.resolve();
let grocerySavePromise = Promise.resolve();
let mealPlanSavePromise = Promise.resolve();
let prefSavePromise = Promise.resolve();

function queueSaveUserPantry() {
  if (!currentUser) return;
  pantrySavePromise = pantrySavePromise.then(async () => {
    const { error: deleteError } = await window.supabaseClient.from('user_pantry').delete().eq('user_id', currentUser.id);
    if (deleteError) return console.error('Failed clearing pantry rows:', deleteError);
    const rows = Object.entries(pantryCounts)
      .filter(([, quantity]) => Number(quantity) > 0)
      .map(([pantry_key, quantity]) => ({ user_id: currentUser.id, pantry_key, quantity }));
    if (!rows.length) return;
    const { error } = await window.supabaseClient.from('user_pantry').insert(rows);
    if (error) console.error('Failed saving pantry rows:', error);
  });
}

function queueSaveUserGrocery() {
  if (!currentUser) return;
  grocerySavePromise = grocerySavePromise.then(async () => {
    const { error: deleteError } = await window.supabaseClient.from('user_grocery_items').delete().eq('user_id', currentUser.id);
    if (deleteError) return console.error('Failed clearing grocery rows:', deleteError);
    const rows = groceryItems.map((item, index) => ({ user_id: currentUser.id, sort_order: index, item }));
    if (!rows.length) return;
    const { error } = await window.supabaseClient.from('user_grocery_items').insert(rows);
    if (error) console.error('Failed saving grocery rows:', error);
  });
}

function queueSaveUserMealPlan() {
  if (!currentUser) return;
  mealPlanSavePromise = mealPlanSavePromise.then(async () => {
    const { error: deleteError } = await window.supabaseClient.from('user_meal_plan').delete().eq('user_id', currentUser.id);
    if (deleteError) return console.error('Failed clearing meal plan rows:', deleteError);
    const rows = mealPlan.map((item, index) => ({ user_id: currentUser.id, sort_order: index, recipe_id: item.recipeId, servings: item.servings }));
    if (!rows.length) return;
    const { error } = await window.supabaseClient.from('user_meal_plan').insert(rows);
    if (error) console.error('Failed saving meal plan rows:', error);
  });
}

function queueSaveUserPreferences() {
  if (!currentUser) return;
  prefSavePromise = prefSavePromise.then(async () => {
    const payload = {
      user_id: currentUser.id,
      theme: currentTheme,
      section_state: sectionState,
      stock_defaults: categoryStockDefaults,
      stock_overrides: ingredientStockOverrides,
    };
    const { error } = await window.supabaseClient.from('user_ui_preferences').upsert(payload);
    if (error) console.error('Failed saving user preferences:', error);
  });
}

async function saveSharedIngredient(item, categoryKey) {
  const categorySlug = uiCategoryToDbSlug(categoryKey);

  const { data: category, error: categoryError } = await window.supabaseClient
    .from('ingredient_categories')
    .select('id')
    .eq('slug', categorySlug)
    .maybeSingle();

  if (categoryError || !category) {
    throw categoryError || new Error(`Missing ingredient category: ${categorySlug}`);
  }

  const slug = slugify(item.name);

  const { data: existing, error: existingError } = await window.supabaseClient
    .from('ingredients')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  const payload = {
    name: item.name,
    slug,
    ingredient_category_id: category.id,
    default_unit: item.pantryUnit || '',
    is_active: true,
  };

  if (existing?.id) {
    const { error } = await window.supabaseClient
      .from('ingredients')
      .update(payload)
      .eq('id', existing.id);

    if (error) throw error;
  } else {
    const { error } = await window.supabaseClient
      .from('ingredients')
      .insert(payload);

    if (error) throw error;
  }
}

async function deleteSharedIngredient(itemName) {
  const { error } = await window.supabaseClient.from('ingredients').delete().eq('slug', slugify(itemName));
  if (error) throw error;
}

function uiCategoryToDbSlug(categoryKey) {
  const map = { meats: 'meat', veggies: 'veggie', grains: 'grain', dairy: 'dairy', spices: 'spice', sauces: 'sauce', bakery: 'bakery', pantry: 'pantry' };
  return map[categoryKey] || 'other';
}

async function refreshSharedCatalog() {
  const { ingredientCatalog, loadedRecipes, recipeFiles, appSettings } = await loadAppDataFromSupabase();
  siteConfig = buildSiteConfig({
    ...APP_DEFAULTS,
    branding: {
      title: appSettings?.title || APP_DEFAULTS.branding.title,
      tagline: appSettings?.tagline || APP_DEFAULTS.branding.tagline,
    },
    defaultTheme: appSettings?.default_theme || APP_DEFAULTS.defaultTheme,
  }, readStoredSiteConfig(), ingredientCatalog);
  recipeFileOptions = recipeFiles;
  recipes = loadedRecipes.map(recipe => normalizeRecipe(recipe)).filter(Boolean);
  pantryCounts = applyStockDefaults(pantryCounts, siteConfig.ingredients);
  enrichIngredientProfiles();
  applyBranding();
  populateRecipeFileFilter();
  renderAll();
}

function getRecipeIngredientNames(recipe) {
  const names = [];
  CATEGORY_KEYS.forEach(category => {
    const items = Array.isArray(recipe.ingredients?.[category]) ? recipe.ingredients[category] : [];
    items.forEach(item => names.push(item));
  });
  return uniqueArray(names);
}

function normalizeIngredient(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(cloves?|cups?|tbsp|tablespoons?|tsp|teaspoons?|lb|lbs|oz|ounces?|medium|small|large)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/s$/, '');
}

function normalizeUnit(unit) {
  const clean = String(unit || '').trim().toLowerCase();
  return UNIT_ALIASES[clean] || clean;
}

function parseNumber(text) {
  const clean = String(text).trim();
  if (/^\d+\s+\d+\/\d+$/.test(clean)) {
    const [whole, fraction] = clean.split(/\s+/);
    return Number(whole) + parseNumber(fraction);
  }
  if (/^\d+\/\d+$/.test(clean)) {
    const [num, den] = clean.split('/').map(Number);
    return den ? num / den : NaN;
  }
  return Number(clean);
}

function formatScaledNumber(value) {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  if (Math.abs(rounded - 0.25) < 0.01) return '1/4';
  if (Math.abs(rounded - 0.5) < 0.01) return '1/2';
  if (Math.abs(rounded - 0.75) < 0.01) return '3/4';
  return String(rounded).replace(/\.0+$/, '');
}

function roundAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatAmount(value) {
  return formatScaledNumber(roundAmount(value));
}

function formatIngredientLine(item) {
  const quantity = item.quantity == null ? '' : formatAmount(item.quantity);
  const unit = item.unit && item.unit !== 'count' ? ` ${item.unit}` : '';
  return `${quantity}${unit}${quantity ? ' ' : ''}${item.name}`.trim();
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toTitleCase(value) {
  return String(value || '').replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function uniqueArray(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
