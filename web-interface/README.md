# AttendX — Smart Attendance Manager

A modern, glassmorphism-styled web application to track and manage your academic attendance — subject-wise.

---

## Features

| Feature | Details |
|---|---|
| **Subject Dashboard** | Cards with progress bars, colour-coded status and predictions |
| **Add / Edit / Delete Subjects** | Full CRUD with duplicate detection |
| **LocalStorage Persistence** | Data survives page refresh, no server required |
| **Smart Prediction** | How many classes you can skip *or* must attend |
| **Analytics Chart** | Bar chart (Chart.js) comparing all subjects at a glance |
| **Quick Calculator** | One-shot calculation without saving — with progress ring |
| **Responsive Design** | Works on mobile, tablet and desktop |
| **Keyboard Shortcuts** | `Ctrl+1/2/3` to switch tabs, `Enter` triggers quick calc |

---

## How to Run

Just open `index.html` in any modern browser — no build step, no server needed.

```
web-interface/
├── index.html   ← open this
├── style.css    ← all styles (glassmorphism, layout, tokens)
├── script.js    ← all logic (data, math, rendering, Chart.js)
└── README.md    ← this file
```

Or double-click `open-web.bat` from the project root.

---

## Maths Behind the Predictions

All formulas mirror the original `project2.c` logic.

**Classes you can skip** (while staying ≥ required %):
```
x = floor( attended * 100 / required - total )
```

**Classes you must attend** (to reach required % from below):
```
y = ceil( (required * total / 100 - attended) / (1 - required / 100) )
```

---

## Tech Stack

- HTML5 + Tailwind CSS (CDN)
- Vanilla JavaScript (ES6+)
- Chart.js 4.4 (CDN)
- Google Fonts — Inter
- Web LocalStorage API

---

Built for academic use · Portfolio-ready · Data never leaves your browser.
