# Smart Market Watchlist

> A signal-over-noise market watchlist that helps users understand what has meaningfully changed since they last checked.

---

## Table of Contents

- [Overview](#overview)
- [Problem](#problem)
- [Key Product Idea](#key-product-idea)
- [Features](#features)
- [Architecture](#architecture)
- [Smart Attention Calculation](#smart-attention-calculation)
- [Data Flow](#data-flow)
- [Scaling Approach](#scaling-approach)
- [Background Refresh](#background-refresh)
- [Resilience and Edge Cases](#resilience-and-edge-cases)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Local Setup](#local-setup)
- [Environment Variables](#environment-variables)
- [Design Decisions](#design-decisions)
- [Trade-offs](#trade-offs)
- [Future Improvements](#future-improvements)
- [Core Philosophy](#core-philosophy)

---

## Overview

**Smart Market Watchlist** is a full-stack market monitoring application designed around one core question:

> **"What actually deserves my attention right now?"**

Traditional watchlists mainly display prices and percentage changes. This project goes further by analyzing multiple market signals and highlighting stocks whose current behavior is unusual or important.

The system combines market data, historical behavior, trading-volume signals, 52-week levels, benchmark-relative movement, and user-defined session baselines to produce an **explainable attention score**.

---

## Problem

A watchlist can contain many stocks, but users usually don't want to repeatedly inspect every stock manually.

A simple price change such as:

```
AAPL +1.2%
```

does not necessarily mean the stock deserves attention. A 1.2% movement may be normal for one stock but highly unusual for another.

**This project focuses on meaningful change rather than raw change.**

---

## Key Product Idea

The application separates two concepts:

- **Market change** — What is happening in the market right now?
- **User-relative change** — What has changed since the user last checked?

Users can explicitly establish a baseline using **Mark as Checked**. The next time they return, the application compares the current state with that saved baseline — making the watchlist **session-aware** instead of treating every visit as a completely new state.

---

## Features

### Watchlist Management
- Create and manage a personal watchlist
- Add and remove stocks
- View latest market information
- User-specific watchlists
- Persistent state across sessions

### Smart Attention Engine
Each stock receives an **attention score from 0-100**, based on:
- Unusual price movement
- Abnormal trading volume
- 52-week high/low proximity
- Movement relative to a market benchmark

The score is accompanied by explanations and individual signal contributions.

### Session-Relative Change
Users can select **Mark as Checked**, which stores:
- Stock
- Price at check time
- Attention score
- Check timestamp

On return, the application shows:
- Price change since last check
- Attention-score change since last check
- Previous check time

### Attention Inbox
Instead of requiring users to scan their entire watchlist, the **Attention Inbox** surfaces stocks that currently deserve attention, ranked by attention score and severity.

### Attention History
Maintains historical attention observations so users can understand how a stock's attention level has evolved over time.

### Market-State Awareness
Distinguishes between states such as:
- Current market data
- Market closed
- Delayed data
- Unknown market state

This prevents the UI from presenting old market data as if it were current.

### Data Resilience
The market-data layer supports:
- Primary and fallback providers
- Persistent caching
- In-memory caching
- Stale-data fallback
- Provider conflict detection
- Rate-limit-aware requests

When providers disagree significantly, the system marks the data as **conflicting** instead of silently presenting one value as unquestionably correct.

### Authentication and User Isolation
- Signup / Login
- JWT authentication
- Password hashing
- Protected API routes
- User-specific watchlists and snapshots

One user's watchlist and snapshots are never used as another user's state.

---

## Architecture

```
                        +----------------------+
                        |       React UI        |
                        |                        |
                        |  Dashboard             |
                        |  Watchlist             |
                        |  Attention Inbox       |
                        |  Attention History     |
                        +-----------+------------+
                                    |
                              HTTP + JWT
                                    |
                        +-----------v------------+
                        |        FastAPI          |
                        |                         |
                        |  Authentication         |
                        |  Watchlist APIs         |
                        |  Snapshot APIs          |
                        |  Smart Analysis         |
                        +--------+-------+--------+
                                 |       |
                    +------------v-+   +-v-------------------+
                    |  PostgreSQL   |   |   Market Data       |
                    |               |   |                     |
                    |  Users        |   |   Alpha Vantage     |
                    |  Watchlists   |   |   Yahoo Finance     |
                    |  Snapshots    |   |                     |
                    |  History      |   +---------------------+
                    +---------------+
                                 ^
                                 |
                        +--------+---------+
                        |   Background     |
                        |  Refresh Worker  |
                        |                  |
                        |  Cache warming   |
                        |  Rate awareness  |
                        +------------------+
```

---

## Smart Attention Calculation

The attention engine produces a score between **0 and 100**, built from four weighted signals:

```
Attention Score
      |
      +-- Price Movement
      |
      +-- Volume Anomaly
      |
      +-- 52-Week Position
      |
      +-- Market-Relative Movement
```

- **Price Movement** — Current movement is compared against recent historical behavior. An unusually large move receives a higher score.
- **Volume Anomaly** — Current/recent volume is compared with historical volume. Unusually high volume can indicate that a price movement deserves additional attention.
- **52-Week Position** — A stock approaching an important 52-week high or low receives additional attention.
- **Market-Relative Movement** — The stock's movement is compared with a benchmark. A stock moving significantly differently from the broader market can receive additional attention.

### Explainability

The system doesn't only return a number — it returns a reasoned assessment:

```
Attention Score: 78
Severity: High

Reasons:
- Unusually large price movement
- Volume significantly above normal
- Near 52-week high
- Outperforming the benchmark
```

This makes the score interpretable rather than an unexplained black box.

---

## Data Flow

```
Market Providers
       |
       v
Market Data Layer
       |
       +-- In-memory cache
       +-- PostgreSQL cache
       +-- Provider comparison
       |
       v
Historical Data
       |
       v
Attention Engine
       |
       v
Shared Attention Result
       |
       v
User Snapshot Comparison
       |
       v
Attention Inbox / Dashboard
```

---

## Scaling Approach

The architecture is designed so market-data work is not unnecessarily duplicated for every user.

- **Shared market data** — cached independently of individual users
- **Shared attention calculation** — cached by symbol rather than recalculated per user
- **User-specific state** — snapshots remain separate from shared market intelligence

```
                    Shared
              +-----------------+
              |  Market Data     |
              |  Historical Data |
              |  Attention Score |
              +--------+---------+
                       |
             +---------+---------+
             |         |         |
             v         v         v
           User A    User B    User C
           Snapshot  Snapshot  Snapshot
```

This allows the system to reuse expensive market-data and analytical work while keeping user-relative comparisons isolated.

---

## Background Refresh

A background worker periodically checks tracked symbols and keeps shared market-data caches warm, separating market-data acquisition from normal user-facing API requests. The worker also accounts for provider queue pressure before continuing refresh work.

**At larger scale**, the next optimization would be a priority-based refresh queue that favors:
- Popular symbols
- Symbols with high attention
- Symbols whose cached data is nearing expiry

This would allow limited market-data API capacity to be allocated where it provides the most value.

---

## Resilience and Edge Cases

- **Market Closed** — Recognizes when the relevant exchange is closed and avoids treating the previous trading day's data as current.
- **Delayed Data** — Flags data as delayed when the latest available trading date doesn't represent the current session.
- **Stale Cache** — Falls back to cached market information (with appropriate stale-data handling) when live providers are unavailable.
- **Provider Failure** — Falls back to a secondary provider if the primary provider fails.
- **Provider Conflict** — Marks the result as a conflict if providers return materially different values, rather than silently hiding the disagreement.
- **Rate Limits** — Throttles market-data requests; the background refresh process is aware of provider queue pressure.
- **Empty/Insufficient History** — Avoids making strong anomaly claims when insufficient historical data is available.

---

## Technology Stack

**Frontend**
- React
- TypeScript
- Vite
- Material UI
- Axios
- React Router

**Backend**
- Python
- FastAPI
- SQLAlchemy
- Pydantic
- JWT authentication
- bcrypt

**Database**
- PostgreSQL

**Market Data**
- Alpha Vantage
- Yahoo Finance

---

## Project Structure

```
smart-market-watchlist/
|
+-- backend/
|   +-- auth.py
|   +-- background_refresh.py
|   +-- change_engine.py
|   +-- database.py
|   +-- main.py
|   +-- market_data.py
|   +-- models.py
|   +-- requirements.txt
|   +-- schemas.py
|   |
|   +-- routes/
|       +-- auth.py
|       +-- snapshot.py
|       +-- watchlist.py
|
+-- frontend/
|   +-- src/
|   |   +-- App.tsx
|   |   +-- Dashboard.tsx
|   |   +-- Login.tsx
|   |   +-- Signup.tsx
|   |   +-- Watchlist.tsx
|   |   +-- api.ts
|   |
|   +-- package.json
|   +-- vite.config.ts
|
+-- .gitignore
+-- README.md
```

---

## Local Setup

### Prerequisites

- Python 3.10+
- Node.js
- PostgreSQL

### Backend Setup

```bash
# Navigate to the backend
cd backend

# Create a virtual environment
python -m venv venv

# Activate it (Windows)
venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt
```

Create a `.env` file inside `backend/`:

```env
DATABASE_URL=postgresql://USERNAME:PASSWORD@localhost:5432/smart_market_watchlist
ALPHA_VANTAGE_API_KEY=YOUR_ALPHA_VANTAGE_KEY
JWT_SECRET_KEY=YOUR_SECRET_KEY
```

Create the PostgreSQL database:

```sql
CREATE DATABASE smart_market_watchlist;
```

Start the backend:

```bash
python -m uvicorn main:app --reload
```

The API will be available at:
- API: http://127.0.0.1:8000
- Swagger docs: http://127.0.0.1:8000/docs

### Frontend Setup

```bash
# Open another terminal
cd frontend

# Install dependencies
npm install

# Start the development server
npm run dev
```

The frontend will be available at: http://localhost:5173

---

## Environment Variables

> Never commit secrets to Git.

- `DATABASE_URL` — PostgreSQL connection
- `ALPHA_VANTAGE_API_KEY` — Market-data access
- `JWT_SECRET_KEY` — Authentication token signing

A real `.env` file should remain local and untracked.

---

## Design Decisions

**Why an attention score?**
A watchlist should reduce cognitive load, not simply display more information. A score provides a quick prioritization mechanism while the underlying reasons preserve transparency.

**Why session-relative snapshots?**
"Changed today" and "changed since I last checked" are different questions. The snapshot mechanism directly models the second question.

**Why multiple market-data providers?**
External market-data providers can fail, become delayed, or disagree. Using fallback data and explicitly representing conflicts makes the application more resilient.

**Why cache market intelligence?**
Market data and derived signals are shared across users. Caching reduces unnecessary provider calls and prevents every user request from triggering the same expensive work.

**Why keep user snapshots separate?**
The market signal is global, but the user's last-checked state is personal. Separating the two allows shared computation without mixing user state.

---

## Trade-offs

This project intentionally avoids unnecessary complexity. For example, the current architecture uses a lightweight background refresh process rather than introducing a distributed message queue.

At larger scale, the refresh system could evolve into a priority queue with dedicated workers — but the current approach keeps the system understandable and appropriately scoped for the problem size.

**The goal is to introduce complexity only where it solves a real bottleneck.**

---

## Future Improvements

- [ ] Priority-based market-data refresh queues
- [ ] Symbol popularity-based refresh frequency
- [ ] Distributed workers
- [ ] More market-data providers
- [ ] Event/news signals
- [ ] Personalized attention thresholds
- [ ] More sophisticated anomaly detection
- [ ] Redis-based shared caching
- [ ] WebSocket-based live updates
- [ ] Production deployment with monitoring and observability

---

## Core Philosophy

> **Don't make users watch the market. Help them know what deserves watching.**

The project is built around the idea that a useful market watchlist should reduce noise, explain why something matters, and remember what the user has already seen.