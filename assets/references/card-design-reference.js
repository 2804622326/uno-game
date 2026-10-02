/* UNO Card Design Reference - JavaScript Implementation */
/* Helper functions to create UNO-style cards programmatically */

// UNO Card Colors
const COLORS = {
  RED: 'red',
  GREEN: 'green',
  BLUE: 'blue',
  YELLOW: 'yellow'
};

// UNO Card Types
const CARD_TYPES = {
  NUMBER: 'number',
  SKIP: 'skip',
  REVERSE: 'reverse',
  DRAW_TWO: 'draw-two',
  WILD: 'wild',
  WILD_DRAW_FOUR: 'wild-draw-four'
};

// Create a number card element
function createNumberCard(color, number) {
  const card = document.createElement('div');
  card.className = `uno-card card-${color} card-number`;
  card.dataset.cardType = 'number';
  card.dataset.color = color;
  card.dataset.value = number;

  card.innerHTML = `
    <div class="top-left">${number}</div>
    <div class="center-number">${number}</div>
    <div class="bottom-right">${number}</div>
  `;

  return card;
}

// Create an action card (Skip, Reverse, Draw Two)
function createActionCard(color, type) {
  const card = document.createElement('div');
  card.className = `uno-card card-${color} card-action card-${type}`;
  card.dataset.cardType = type;
  card.dataset.color = color;

  const typeMap = {
    'skip': '→',
    'reverse': '↻',
    'draw-two': '+2'
  };

  const typeName = typeMap[type] || '';
  card.innerHTML = `
    <div class="top-left">${typeName}</div>
    <div class="icon icon-${type}"></div>
    <div class="bottom-right" style="transform: rotate(180deg);">${typeName}</div>
  `;

  return card;
}

// Create a wild card
function createWildCard(type = 'wild') {
  const card = document.createElement('div');
  card.className = `uno-card card-${type}`;
  card.dataset.cardType = type;
  card.dataset.color = 'wild';

  if (type === 'wild') {
    card.innerHTML = `
      <div class="top-left">★</div>
      <div class="icon icon-wild"></div>
      <div class="bottom-right" style="transform: rotate(180deg);">★</div>
    `;
  } else {
    // Wild Draw Four
    card.innerHTML = `
      <div class="top-left">+4</div>
      <div class="center-number" style="font-size: 48px;">+4</div>
      <div class="icon icon-wild-draw-four"></div>
      <div class="bottom-right" style="transform: rotate(180deg);">+4</div>
    `;
  }

  return card;
}

// Create the card back
function createCardBack() {
  const card = document.createElement('div');
  card.className = 'uno-card card-back';
  return card;
}

// Chance Card - "0" special card design
function createChanceCard0() {
  const card = document.createElement('div');
  card.className = 'uno-card card-chance-0';
  card.dataset.cardType = 'chance-0';
  card.style.background = 'linear-gradient(135deg, #f0e68c, #daa520)';
  card.style.border = '3px solid #ff6b6b';

  card.innerHTML = `
    <div class="top-left" style="color: black;">0</div>
    <div class="center-number" style="font-size: 48px; color: black; display: flex; align-items: center; justify-content: center;">
      <span style="font-size: 24px;">🎲</span>
    </div>
    <div style="position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); font-size: 12px; color: black;">
      機會牌
    </div>
  `;

  return card;
}

// Color picker for Wild cards
function createColorPicker(onColorSelect) {
  const colors = ['red', 'green', 'blue', 'yellow'];
  const picker = document.createElement('div');
  picker.className = 'color-picker';
  picker.style.position = 'fixed';
  picker.style.top = '50%';
  picker.style.left = '50%';
  picker.style.transform = 'translate(-50%, -50%)';
  picker.style.display = 'flex';
  picker.style.gap = '10px';
  picker.style.padding = '20px';
  picker.style.backgroundColor = 'rgba(0,0,0,0.8)';
  picker.style.borderRadius = '8px';
  picker.style.zIndex = '1000';

  colors.forEach(color => {
    const button = document.createElement('button');
    button.style.width = '50px';
    button.style.height = '50px';
    button.style.backgroundColor = color;
    button.style.border = '2px solid white';
    button.style.borderRadius = '50%';
    button.style.cursor = 'pointer';
    button.onclick = () => {
      onColorSelect(color);
      document.body.removeChild(picker);
    };
    picker.appendChild(button);
  });

  document.body.appendChild(picker);
}

// Dice roller for "Lightning" chance card
function rollDice() {
  return Math.floor(Math.random() * 6) + 1;
}

// Export functions if using modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COLORS,
    CARD_TYPES,
    createNumberCard,
    createActionCard,
    createWildCard,
    createCardBack,
    createChanceCard0,
    createColorPicker,
    rollDice
  };
}