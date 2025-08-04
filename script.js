const chartInstances = {};  // Stores charts by canvas ID
let rawData = [];

document.addEventListener('DOMContentLoaded', () => {
  fetch('combined.json')
  .then(response => response.json())
  .then(json => {
    rawData = json;
    const defaultClass = 'kitsunagi';  // or choose from dropdown default
    load(defaultClass, rawData);
  })
  .catch(err => console.error('Failed to load data:', err));
});

function getHighestFloorHistogram(data, selectedClass) {
  const sessions = {};

  data.forEach(entry => {
    if (selectedClass !== 'all' && entry.playerClass !== selectedClass) return;
    const id = entry.sessionId;
    if (!sessions[id]) sessions[id] = [];
    sessions[id].push(entry);
  });

  const lastEntries = Object.values(sessions).map(session =>
    session.sort((a, b) => a.timestamp - b.timestamp).at(-1)
  );

  // Bin floors into fixed labels: '1', '2', '3', '4', '5+'
  const counts = [0, 0, 0, 0, 0]; // index 0: floor 1, ..., index 4: 5+

  lastEntries.forEach(e => {
    const floor = e.floor ?? 0;
    if (floor >= 5) {
      counts[4] += 1;
    } else if (floor >= 1) {
      counts[floor - 1] += 1;
    }
  });

  return counts; // aligned with ['1', '2', '3', '4', '5+']
}

function getTopCombos(data, selectedClass, topN = 5) {
  const comboCounts = {};

  data.forEach(entry => {
    if (selectedClass !== 'all' && entry.playerClass !== selectedClass || !entry.comboUseCounts) return;

    const keys = entry.comboUseCounts.keys || [];
    const values = entry.comboUseCounts.values || [];

    keys.forEach((combo, i) => {
      const count = parseInt(values[i], 10) || 0;
      comboCounts[combo] = (comboCounts[combo] || 0) + count;
    });
  });

  return Object.fromEntries(
    Object.entries(comboCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
  );
}

function getTopTrinkets(data, selectedClass, topN = 5) {
  const sessionMap = new Map();

  // Group by sessionId and pick last timestamped entry
  data.forEach(entry => {
    if (selectedClass !== 'all' && entry.playerClass !== selectedClass) return;
    const current = sessionMap.get(entry.sessionId);
    if (!current || entry.timestamp > current.timestamp) {
      sessionMap.set(entry.sessionId, entry);
    }
  });

  // Count trinkets from last entries
  const trinketCounts = {};
  sessionMap.forEach(entry => {
    (entry.trinkets || []).forEach(trinket => {
      trinketCounts[trinket] = (trinketCounts[trinket] || 0) + 1;
    });
  });

  const totalSessions = sessionMap.size;
  const sorted = Object.entries(trinketCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  return sorted.map(([name, count]) => ({
    name: name.replace(/^trinket_/, ''),
    stat: `${Math.round((count / totalSessions) * 100)}% owned`
  }));
}

function getTopCards(data, selectedClass, topN = 5) {
  const cardCounts = {};

  data.forEach(entry => {
    if (selectedClass !== 'all' && entry.playerClass !== selectedClass) return;

    const cardUse = entry.cardUseCounts;
    if (!cardUse || !cardUse.keys || !cardUse.values) return;

    cardUse.keys.forEach((card, i) => {
      const count = parseInt(cardUse.values[i]);
      if (!isNaN(count)) {
        cardCounts[card] = (cardCounts[card] || 0) + count;
      }
    });
  });

  const sorted = Object.entries(cardCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  return sorted.map(([name, count]) => ({
    name: name.replace(/^card_/, '').replace(/_/g, ' '),
    stat: `${count} uses`
  }));
}

function getTopEnemies(data, selectedClass, topN = 5) {
  const winCounts = {};
  let totalWins = 0;

  data.forEach(entry => {
    if (selectedClass !== 'all' && entry.playerClass !== selectedClass) return;
    if (entry.winnerIndex !== "2") return;

    const enemy = entry.enemyClass;
    winCounts[enemy] = (winCounts[enemy] || 0) + 1;
    totalWins++;
  });

  const sorted = Object.entries(winCounts)
    .map(([enemy, count]) => ({
      name: enemy.replace(/^enemy_/, '').replace(/_/g, ' ').toLowerCase(),
      winRate: Math.round((count / totalWins) * 100)
    }))
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, topN);

  return sorted;
}

function getBestTrinketPairs(data, selectedClass, trinketName, topN = 5) {
  const totals = new Map();
  const counts = new Map();

  data.forEach(entry => {
    if (selectedClass !== 'all' && entry.playerClass !== selectedClass) return;
    if (!Array.isArray(entry.trinkets)) return;
    if (!entry.trinkets.includes(trinketName)) return;

    const dmg = parseFloat(entry.averageOutgoingDamage);
    if (isNaN(dmg)) return;

    entry.trinkets.forEach(other => {
      if (other === trinketName) return;
      totals.set(other, (totals.get(other) || 0) + dmg);
      counts.set(other, (counts.get(other) || 0) + 1);
    });
  });

  return Object.fromEntries(
    Array.from(totals.entries())
      .map(([coTrinket, totalDmg]) => {
        const avg = totalDmg / counts.get(coTrinket);
        return [
          coTrinket.replace(/^trinket_/, '').replace(/_/g, ' '),
          parseFloat(avg.toFixed(1))
        ];
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
  );
}

function getBestCardPairs(data, selectedClass, cardName, topN = 5) {
  const pairTotals = new Map();

  const targetCard = cardName.startsWith('card_')
    ? cardName
    : `card_${cardName.toLowerCase().replace(/ /g, '_')}`;

  data.forEach(entry => {
    if (selectedClass !== 'all' && entry.playerClass !== selectedClass) return;
    if (!entry.cardUseCounts?.keys) return;

    const damage = parseFloat(entry.averageOutgoingDamage);
    if (isNaN(damage) || damage <= 0) return;

    const cards = entry.cardUseCounts.keys;
    if (!cards.includes(targetCard)) return;

    for (const otherCard of cards) {
      if (otherCard === targetCard) continue;

      if (!pairTotals.has(otherCard)) {
        pairTotals.set(otherCard, { totalDamage: 0, count: 0 });
      }

      const stats = pairTotals.get(otherCard);
      stats.totalDamage += damage;
      stats.count += 1;
    }
  });

  const averaged = Array.from(pairTotals.entries())
    .map(([card, { totalDamage, count }]) => [card, totalDamage / count])
    .filter(([, avg]) => !isNaN(avg) && isFinite(avg))
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  return Object.fromEntries(
    averaged.map(([card, avg]) => [
      card.replace(/^card_/, '').replace(/_/g, ' '),
      Math.round(avg)
    ])
  );
}

function createBarChart(canvasId, chartTitle, name, labels, data, color = '#4e79a7') {
  const ctx = document.getElementById(canvasId).getContext('2d');

  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
  }

  chartInstances[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: name,
        data: data,
        backgroundColor: color
      }]
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: chartTitle,
          color: '#ffffff',
          font: {
            size: 20,
          }
        }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

function renderCircles(containerId, items) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  items.forEach(({ name, stat }) => {
    const circle = document.createElement('div');
    circle.className = 'circle';
    circle.innerHTML = `
      <div class="circle-title">${name}</div>
      <div class="circle-subtitle">${stat}</div>
    `;
    container.appendChild(circle);
  });
}

function renderEnemies(containerId, data) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  data.forEach(({ name, winRate }) => {
    const image = `Enemies/${name}.png`
    const div = document.createElement('div');
    div.className = 'enemy';
    div.innerHTML = `
      <div class="enemy-name">${name}</div>
      <img src="${image}" class="enemy-img" onerror="this.onerror=null; this.src='Enemies/placeholder.png';">
      <div class="win-rate">Win Rate: ${winRate}%</div>
    `;
    container.appendChild(div);
  });
}

function updatePickRate(data, selectedClass) {
  const label = document.getElementById('pick-rate-label');
  if (selectedClass === 'all') {
    label.textContent = 'Pick Rate: —';
    return;
  }

  const total = data.filter(d => d.playerClass).length;
  const selectedCount = data.filter(d => d.playerClass === selectedClass).length;
  const rate = total ? ((selectedCount / total) * 100).toFixed(1) : 0;
  label.textContent = `Pick Rate: ${rate}%`;
}

function load (selectedClass, data) {
  updatePickRate(data, selectedClass);
  const labels = ['1', '2', '3', '4', '5+'];
  const values = getHighestFloorHistogram(data, selectedClass);
  createBarChart('barChart1', 'Highest Floor Reached', 'Times', labels, values, '#5865f2');
  const combos = getTopCombos(data, selectedClass); // or use selected class
  createBarChart('barChart2', 'Top Card Combos', 'Uses', Object.keys(combos), Object.values(combos), '#f28e2b');
  const trinkets = getTopTrinkets(data, selectedClass);
  renderCircles('trinketCircles', trinkets);
  const cards = getTopCards(data, selectedClass);
  renderCircles('cardCircles', cards);
  const enemies = getTopEnemies(data, selectedClass);
  renderEnemies('enemyStats', enemies);
  const trinketPairs = getBestTrinketPairs(data, selectedClass, `trinket_${trinkets[0]?.name}`)
  createBarChart('barChart3', `best combos with trinket ${trinkets[0]?.name}`, 'Avg Dmg', Object.keys(trinketPairs), Object.values(trinketPairs), '#2dd4bf');
  const cardPairs = getBestCardPairs(data, selectedClass, `card_${cards[0]?.name}`)
  console.log(cardPairs);
  createBarChart('barChart4', `best combos with card ${cards[0]?.name}`, 'Avg Dmg', Object.keys(cardPairs), Object.values(cardPairs), '#2dd4bf');
};

document.getElementById('class-selector').addEventListener('change', function (e) {
  const selectedClass = e.target.value;
  document.getElementById('header-title').textContent = 'class: ' + selectedClass;
  const img = document.getElementById('character-image');
  
  if (selectedClass === 'all') {
    img.src = 'Enemies/placeholder.png';
  } else {
    img.src = `Characters/${selectedClass}.png`;
  }
  
  load(selectedClass, rawData);
});

document.getElementById('updateTrinketGraph').addEventListener('click', () => {
  const trinket = document.getElementById('trinketInput').value.trim().toLowerCase();
  if (!trinket) return;

  const selectedClass = document.getElementById('class-selector').value;
  const pairs = getBestTrinketPairs(rawData, selectedClass, `trinket_${trinket}`);
  const labels = Object.keys(pairs);
  const data = Object.values(pairs);

  createBarChart('barChart3', `best combos with ${trinket}`, 'Avg Dmg', labels, data, '#2dd4bf');
});

document.getElementById('updateCardGraph').addEventListener('click', () => {
  const card = document.getElementById('cardInput').value.trim().toLowerCase();
  if (!card) return;

  const selectedClass = document.getElementById('class-selector').value;
  const pairs = getBestCardPairs(rawData, selectedClass, `card_${card}`);
  const labels = Object.keys(pairs);
  const data = Object.values(pairs);

  createBarChart('barChart4', `best combos with ${card}`, 'Avg Dmg', labels, data, '#2dd4bf');
});
