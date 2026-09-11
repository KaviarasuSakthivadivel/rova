# Job Indexer / Dreamwork-style Job Crawler — Conversation

## User
how does anyone get open jobs in the internet like this? https://www.dreamworkhq.com/research

## Assistant
Yes — and the interesting part is that **Dreamwork isn't manually finding 669K jobs**. They’ve essentially built a job-crawling/search system.

Their research page says they currently track **669,262 open roles across 20,917 tech companies**, refreshed daily, with **106,674 roles added this week**. ([dreamworkhq.com](https://www.dreamworkhq.com/research))

### How do sites like Dreamwork get these jobs?

The basic architecture is probably something like:

**Company career pages → ATS APIs/pages → crawler → normalize → database → search/analytics**

For example:

1. **Find company career pages**
   - `company.com/careers`
   - `jobs.company.com`
   - Greenhouse
   - Lever
   - Workday
   - Ashby
   - SmartRecruiters
   - iCIMS
   - custom ATS systems

2. **Crawl them regularly**

   A crawler visits those career pages and detects:
   - new job postings
   - removed/closed jobs
   - changes to salary
   - location changes
   - title/description changes

3. **Normalize everything**

   Every company describes jobs differently.

   For example:

   > Software Engineer II — Backend

   and

   > Backend Software Engineer, L4

   might get normalized into something like:

   ```text
   function: Engineering
   role: Software Engineer
   level: Senior/Mid
   skills: Java, Kafka, AWS
   location: Bay Area
   ```

4. **Store historical snapshots**

   This is where Dreamwork becomes more interesting than LinkedIn.

   They can say things like:

   > "Nuro has 104 open roles"

   and

   > "Nuro had 112 roles 60 days ago"

   because they're storing the history of what they crawl. Their Nuro page actually shows that type of hiring trend data. ([dreamworkhq.com](https://www.dreamworkhq.com/c/nuro.ai?utm_source=chatgpt.com))

5. **Apply NLP/LLMs to the postings**

   Their pages classify jobs into things like:
   - Engineering
   - Research
   - Product
   - Senior/Staff/Principal
   - AI-focused
   - Remote
   - salary bands

   Some of this can be derived deterministically, while other fields are likely extracted/classified from the job description.

6. **Link back to the original application**

   This is important: they don't need to employ anyone or have access to the company's recruiting system.

   They're essentially indexing **publicly available job information** and directing the candidate to the original job/application.

---

### And here's the really interesting part

Dreamwork's GitHub gives away part of their strategy.

They have a repository called **Senior Software Engineer Jobs** that says it pulls roles from Dreamwork, and explicitly says:

> "Listings come from Dreamwork, which crawls 400,000+ jobs directly from company career pages."

It was updated today and currently contains 3,000+ open listings in that particular collection. ([github.com](https://github.com/dreamworkhq/Senior-Software-Engineer-Jobs?utm_source=chatgpt.com))

So they're not just scraping LinkedIn.

They're going **directly to the source**.

That's actually a much better strategy.

---

## User
how can I do something like that? May be every day crawl jobs portals and index?

## Assistant
Absolutely. You can build a **small, personal version of Dreamwork** without needing 20K companies. In fact, I’d recommend starting with **company career pages + ATS feeds**, rather than crawling LinkedIn/Indeed.

A good architecture would look like this:

```text
                 Company / ATS sources
                         │
          ┌──────────────┼──────────────┐
          ↓              ↓              ↓
      Greenhouse       Lever          Ashby
          │              │              │
          └──────────────┼──────────────┘
                         ↓
                  Job Ingestion
                         ↓
                Normalize / Dedup
                         ↓
              ┌──────────┴──────────┐
              ↓                     ↓
          PostgreSQL           Embeddings
              │                     │
              └──────────┬──────────┘
                         ↓
                    Job Search
                         ↓
                  Your Job Matcher
                         ↓
              Daily email / Slack alert
```

### 1. Start with 100–500 companies

Don't start by trying to crawl the entire internet.

Create a list like:

```text
OpenAI
Anthropic
Databricks
Snowflake
Stripe
Uber
Airbnb
Nvidia
Meta
Google
Salesforce
Scale AI
Cursor
...
```

You can store:

```text
company
career_url
ats_type
ats_identifier
last_crawled
active
```

The **ATS identifier** is particularly useful.

For example, many companies expose their jobs through structured endpoints rather than requiring you to scrape HTML.

---

### 2. Build adapters for each ATS

This is probably the most important engineering decision.

Instead of writing:

```text
scrape_everything.py
```

build:

```text
JobSource
   ├── GreenhouseSource
   ├── LeverSource
   ├── AshbySource
   ├── WorkdaySource
   └── GenericCareerPageSource
```

Each adapter returns the same object:

```json
{
  "company": "Example",
  "title": "Senior Software Engineer",
  "location": "San Francisco, CA",
  "description": "...",
  "url": "...",
  "salary_min": 220000,
  "salary_max": 300000,
  "posted_at": "...",
  "source": "greenhouse",
  "external_id": "12345"
}
```

Now your database doesn't care where the job came from.

---

### 3. Crawl every day

You don't actually need to crawl everything every hour.

For a personal system:

**Daily:**

```text
2:00 AM
   ↓
Fetch company list
   ↓
Fetch current jobs
   ↓
Compare against yesterday
   ↓
New jobs?
   ↓
Changed jobs?
   ↓
Removed jobs?
```

The important thing is to maintain **job history**.

For example:

```text
job_id       18392
company      Databricks
title        Staff Software Engineer
first_seen   2026-08-20
last_seen    2026-08-25
status       OPEN
```

Then you can answer:

> "Show me jobs posted in the last 24 hours."

That's much more useful than simply having a current job table.

---

### 4. Use PostgreSQL first

You don't need Elasticsearch initially.

I'd start with:

```text
PostgreSQL
```

Tables:

```text
companies
jobs
job_snapshots
job_skills
crawl_runs
```

Something like:

```text
jobs
-----------------------------
id
company_id
external_id
title
description
location
employment_type
salary_min
salary_max
url
source
first_seen_at
last_seen_at
status
```

Then add **pgvector** when you want semantic search.

---

### 5. Add embeddings

This is where your system gets much more interesting.

Suppose your profile says:

> Distributed systems engineer with Java, Kafka, AWS, databases, large-scale backend systems and AI infrastructure experience.

A normal keyword search might miss:

> "Senior Infrastructure Engineer — Streaming Platform"

because the job doesn't explicitly say "Kafka" in the title.

Embedding search can recognize that they're related.

You could store:

```text
job_description
       ↓
embedding
       ↓
pgvector
```

Then:

```text
User profile embedding
        ↓
cosine similarity
        ↓
top 100 jobs
```

---

### 6. Then add an LLM/ranking layer

Don't ask an LLM to search the entire database.

Instead:

```text
10,000 jobs
     ↓
SQL filters
     ↓
1,000 jobs
     ↓
vector similarity
     ↓
100 jobs
     ↓
LLM ranking
     ↓
10 excellent matches
```

The LLM could produce:

```json
{
  "score": 94,
  "why": [
    "Strong Java backend match",
    "Kafka/distributed systems experience relevant",
    "AWS experience directly applicable"
  ],
  "missing": [
    "Kubernetes"
  ]
}
```

This gives you a **personalized job search engine**, rather than another job board.

---

### 7. The killer feature: daily digest

I'd make this the first version's actual product.

Every morning:

### 🚨 7 new jobs worth looking at

**1. Staff Software Engineer — AI Infrastructure**  
Company X · San Francisco · $280–350K  
**Match: 94%**

Why:
- Distributed systems
- Java
- Kafka
- AWS
- AI infrastructure

---

**2. Senior Backend Engineer — Data Platform**  
Company Y · Remote  
**Match: 91%**

Why:
- Data infrastructure
- High-throughput systems
- Java
- Kubernetes

---

And importantly:

> **Why am I seeing this?**

That makes the system dramatically more useful.

---

## User
Sketch out the actual database schema, Python crawler architecture, and Greenhouse/Lever/Ashby ingestion code for an MVP

## Assistant
Yes. For an MVP, I’d make the system **boring and reliable first**: provider APIs → normalized jobs → PostgreSQL → daily crawl → history/dedup. Add embeddings and LLM ranking only after that works.

The three providers are particularly suitable for this approach because they expose public job data: Greenhouse’s Job Board API provides published jobs without authentication, Lever exposes published postings through its Postings API, and Ashby exposes a public job-postings endpoint. ([developer.greenhouse.io](https://developer.greenhouse.io/job-board.html?utm_source=chatgpt.com))

## 1. Project structure

I’d start with this:

```text
job-indexer/
├── app/
│   ├── config.py
│   ├── models.py
│   ├── db.py
│   ├── schemas.py
│   │
│   ├── sources/
│   │   ├── base.py
│   │   ├── greenhouse.py
│   │   ├── lever.py
│   │   └── ashby.py
│   │
│   ├── pipeline/
│   │   ├── normalize.py
│   │   ├── dedupe.py
│   │   └── ingest.py
│   │
│   └── main.py
│
├── migrations/
├── scripts/
│   ├── seed_companies.py
│   └── crawl.py
│
├── tests/
├── docker-compose.yml
├── requirements.txt
└── .env
```

The key abstraction is:

```text
                         ┌── Greenhouse
                         ├── Lever
JobSource ───────────────┼── Ashby
                         ├── Workday (later)
                         └── Generic HTML (later)
                              │
                              ↓
                         NormalizedJob
                              │
                              ↓
                           Postgres
```

# 2. Database schema

I'd use PostgreSQL.

You need only four core tables initially:

```text
companies
jobs
job_snapshots
crawl_runs
```

### `companies`

```sql
CREATE TABLE companies (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,

    ats             TEXT NOT NULL,
    ats_identifier  TEXT NOT NULL,

    careers_url     TEXT,

    active          BOOLEAN NOT NULL DEFAULT TRUE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (ats, ats_identifier)
);
```

Example:

```text
id | name        | ats        | ats_identifier
---+-------------+------------+---------------
1  | Anthropic   | greenhouse | anthropic
2  | ExampleCo   | lever      | exampleco
3  | AnotherCo   | ashby      | anotherco
```

## `jobs`

This contains the **current state**.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    company_id          BIGINT NOT NULL REFERENCES companies(id),

    source              TEXT NOT NULL,
    external_id         TEXT NOT NULL,

    title               TEXT NOT NULL,
    description         TEXT,

    location            TEXT,
    workplace_type      TEXT,

    department          TEXT,
    team                TEXT,
    employment_type     TEXT,
    seniority           TEXT,

    salary_currency     TEXT,
    salary_min          NUMERIC,
    salary_max          NUMERIC,
    salary_interval     TEXT,

    job_url             TEXT NOT NULL,
    apply_url           TEXT,

    posted_at           TIMESTAMPTZ,
    source_updated_at   TIMESTAMPTZ,

    status              TEXT NOT NULL DEFAULT 'OPEN',

    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at           TIMESTAMPTZ,

    content_hash        TEXT NOT NULL,

    embedding            vector(1536),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (source, external_id)
);
```

The important columns are:

```text
source
external_id
first_seen_at
last_seen_at
status
content_hash
```

Those let you answer:

> What jobs are new today?

and:

> What jobs disappeared?

without relying on the provider's `posted_at` field.

# 3. Historical snapshots

This is what eventually makes your system much more valuable.

```sql
CREATE TABLE job_snapshots (
    id              BIGSERIAL PRIMARY KEY,

    job_id          UUID NOT NULL REFERENCES jobs(id),

    title           TEXT NOT NULL,
    description     TEXT,

    location        TEXT,
    workplace_type  TEXT,

    salary_min      NUMERIC,
    salary_max      NUMERIC,

    content_hash    TEXT NOT NULL,

    captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Every time something changes:

```text
Job
 │
 ├── Aug 20 snapshot
 ├── Aug 21 snapshot
 ├── Aug 22 snapshot
 └── Aug 25 snapshot
```

Now you can eventually build:

> "Company X added 37 engineering jobs in August."

# 4. Crawl runs

```sql
CREATE TABLE crawl_runs (
    id              BIGSERIAL PRIMARY KEY,

    company_id      BIGINT REFERENCES companies(id),

    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,

    status          TEXT NOT NULL,

    jobs_seen       INTEGER DEFAULT 0,
    jobs_added      INTEGER DEFAULT 0,
    jobs_updated    INTEGER DEFAULT 0,
    jobs_closed     INTEGER DEFAULT 0,

    error_message   TEXT
);
```

This makes failures observable.

# 5. Indexes

Start with these:

```sql
CREATE INDEX idx_jobs_company
    ON jobs(company_id);

CREATE INDEX idx_jobs_status
    ON jobs(status);

CREATE INDEX idx_jobs_first_seen
    ON jobs(first_seen_at);

CREATE INDEX idx_jobs_posted
    ON jobs(posted_at);

CREATE INDEX idx_jobs_title
    ON jobs USING GIN (to_tsvector('english', title));

CREATE INDEX idx_jobs_description
    ON jobs USING GIN (to_tsvector('english', description));
```

Later, for semantic search:

```sql
CREATE INDEX idx_jobs_embedding
ON jobs
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

Don't add that on day one unless you're actually using embeddings.

# 6. Python dependencies

I'd keep the dependency set small:

```text
fastapi
uvicorn
httpx
pydantic
pydantic-settings
sqlalchemy
psycopg[binary]
alembic
beautifulsoup4
lxml
tenacity
python-dateutil
```

`httpx` is enough for the ATS APIs.

# 7. Common provider interface

This is the most important piece.

### `app/sources/base.py`

```python
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Optional


@dataclass
class NormalizedJob:
    external_id: str

    title: str
    description: str

    location: Optional[str] = None
    workplace_type: Optional[str] = None

    department: Optional[str] = None
    team: Optional[str] = None
    employment_type: Optional[str] = None
    seniority: Optional[str] = None

    salary_currency: Optional[str] = None
    salary_min: Optional[Decimal] = None
    salary_max: Optional[Decimal] = None
    salary_interval: Optional[str] = None

    job_url: Optional[str] = None
    apply_url: Optional[str] = None

    posted_at: Optional[datetime] = None
    source_updated_at: Optional[datetime] = None


class JobSource(ABC):

    @abstractmethod
    async def fetch_jobs(self) -> list[NormalizedJob]:
        """Return currently published jobs."""
        raise NotImplementedError
```

Every ATS now looks identical to the ingestion pipeline.

# 8. Greenhouse adapter

Greenhouse's public Job Board API endpoint is:

```text
GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs
```

and `content=true` includes the full posting content. No authentication is required for the GET endpoints. ([developer.greenhouse.io](https://developer.greenhouse.io/job-board.html?utm_source=chatgpt.com))

### `app/sources/greenhouse.py`

```python
from datetime import datetime
from typing import Any

import httpx

from .base import JobSource, NormalizedJob


class GreenhouseSource(JobSource):

    BASE_URL = "https://boards-api.greenhouse.io/v1/boards"

    def __init__(
        self,
        board_token: str,
        timeout: float = 30.0,
    ):
        self.board_token = board_token
        self.timeout = timeout

    async def fetch_jobs(self) -> list[NormalizedJob]:

        url = (
            f"{self.BASE_URL}/"
            f"{self.board_token}/jobs"
        )

        params = {
            "content": "true",
        }

        async with httpx.AsyncClient(
            timeout=self.timeout
        ) as client:

            response = await client.get(
                url,
                params=params,
            )

            response.raise_for_status()

            data = response.json()

        jobs = []

        for raw in data.get("jobs", []):
            jobs.append(
                self._normalize(raw)
            )

        return jobs

    @staticmethod
    def _normalize(raw: dict[str, Any]) -> NormalizedJob:

        location = (
            raw.get("location", {})
               .get("name")
        )

        offices = raw.get("offices") or []

        if not location and offices:
            location = offices[0].get("location")

        return NormalizedJob(
            external_id=str(raw["id"]),

            title=raw["title"],

            description=(
                raw.get("content") or ""
            ),

            location=location,

            job_url=raw.get(
                "absolute_url"
            ),

            posted_at=_parse_datetime(
                raw.get("first_published")
            ),

            source_updated_at=_parse_datetime(
                raw.get("updated_at")
            ),
        )


def _parse_datetime(
    value: str | None,
) -> datetime | None:

    if not value:
        return None

    return datetime.fromisoformat(
        value.replace("Z", "+00:00")
    )
```

One caveat: Greenhouse's list response has documented fields such as `id`, `title`, `location`, `absolute_url`, and `updated_at`; full descriptions come from `content=true`. ([developer.greenhouse.io](https://developer.greenhouse.io/job-board.html?utm_source=chatgpt.com))

# 9. Lever adapter

Lever's published-postings API uses:

```text
GET https://api.lever.co/v0/postings/{SITE}?mode=json
```

and supports pagination with `skip` and `limit`. Its JSON postings include fields such as title, categories, description, hosted URL, apply URL, workplace type and optional salary information. ([github.com](https://github.com/lever/postings-api/blob/master/README.md))

### `app/sources/lever.py`

```python
from typing import Any

import httpx

from .base import JobSource, NormalizedJob


class LeverSource(JobSource):

    BASE_URL = "https://api.lever.co/v0/postings"

    def __init__(
        self,
        site: str,
        timeout: float = 30.0,
    ):
        self.site = site
        self.timeout = timeout

    async def fetch_jobs(self) -> list[NormalizedJob]:

        jobs = []

        skip = 0
        limit = 100

        async with httpx.AsyncClient(
            timeout=self.timeout
        ) as client:

            while True:

                response = await client.get(
                    f"{self.BASE_URL}/{self.site}",
                    params={
                        "mode": "json",
                        "skip": skip,
                        "limit": limit,
                    },
                )

                response.raise_for_status()

                batch = response.json()

                if not batch:
                    break

                jobs.extend(
                    self._normalize(job)
                    for job in batch
                )

                if len(batch) < limit:
                    break

                skip += limit

        return jobs

    @staticmethod
    def _normalize(
        raw: dict[str, Any]
    ) -> NormalizedJob:

        categories = (
            raw.get("categories") or {}
        )

        salary = (
            raw.get("salaryRange") or {}
        )

        return NormalizedJob(
            external_id=str(raw["id"]),

            title=raw["text"],

            description=(
                raw.get("descriptionPlain")
                or ""
            ),

            location=categories.get(
                "location"
            ),

            workplace_type=raw.get(
                "workplaceType"
            ),

            department=categories.get(
                "department"
            ),

            team=categories.get(
                "team"
            ),

            employment_type=categories.get(
                "commitment"
            ),

            salary_currency=salary.get(
                "currency"
            ),

            salary_min=salary.get("min"),

            salary_max=salary.get("max"),

            salary_interval=salary.get(
                "interval"
            ),

            job_url=raw.get(
                "hostedUrl"
            ),

            apply_url=raw.get(
                "applyUrl"
            ),
        )
```

Notice something useful here: Lever already provides fields such as `workplaceType`, `salaryRange`, team, department, and commitment, so you don't need an LLM to infer those fields initially. ([github.com](https://github.com/lever/postings-api/blob/master/README.md))

# 10. Ashby adapter

Ashby's public Job Postings API is:

```text
GET https://api.ashbyhq.com/posting-api/job-board/{JOB_BOARD_NAME}
```

and supports `includeCompensation=true`. ([developers.ashbyhq.com](https://developers.ashbyhq.com/docs/public-job-posting-api?utm_source=chatgpt.com))

### `app/sources/ashby.py`

```python
from typing import Any

import httpx

from .base import JobSource, NormalizedJob


class AshbySource(JobSource):

    BASE_URL = (
        "https://api.ashbyhq.com/"
        "posting-api/job-board"
    )

    def __init__(
        self,
        job_board_name: str,
        timeout: float = 30.0,
    ):
        self.job_board_name = job_board_name
        self.timeout = timeout

    async def fetch_jobs(self) -> list[NormalizedJob]:

        url = (
            f"{self.BASE_URL}/"
            f"{self.job_board_name}"
        )

        async with httpx.AsyncClient(
            timeout=self.timeout
        ) as client:

            response = await client.get(
                url,
                params={
                    "includeCompensation": "true"
                },
            )

            response.raise_for_status()

            data = response.json()

        return [
            self._normalize(job)
            for job in data.get("jobs", [])
            if job.get("isListed", True)
        ]

    @staticmethod
    def _normalize(
        raw: dict[str, Any]
    ) -> NormalizedJob:

        compensation = (
            raw.get("compensation") or {}
        )

        return NormalizedJob(
            external_id=str(
                raw.get("jobUrl")
                or raw.get("title")
            ),

            title=raw["title"],

            description=(
                raw.get("descriptionHtml")
                or raw.get("descriptionPlain")
                or ""
            ),

            location=raw.get(
                "location"
            ),

            department=raw.get(
                "department"
            ),

            team=raw.get(
                "team"
            ),

            job_url=raw.get(
                "jobUrl"
            ),

            apply_url=raw.get(
                "applyUrl"
            ),
        )
```

### Important Ashby note

I'd improve the `external_id` here once you inspect the actual payload you're ingesting. The API's documented response includes job-specific identifiers and fields that vary with what Ashby has available; don't use the title as a long-term identity key. ([developers.ashbyhq.com](https://developers.ashbyhq.com/docs/public-job-posting-api?utm_source=chatgpt.com))

# 11. Normalize descriptions

Different providers return HTML.

You don't want:

```text
<p>About us</p><br><ul>...
```

stored as your searchable text.

Create:

### `app/pipeline/normalize.py`

```python
import hashlib
import re

from bs4 import BeautifulSoup


def html_to_text(value: str | None) -> str:

    if not value:
        return ""

    soup = BeautifulSoup(
        value,
        "lxml",
    )

    text = soup.get_text(
        separator=" ",
        strip=True,
    )

    return re.sub(
        r"\s+",
        " ",
        text,
    ).strip()


def content_hash(
    title: str,
    description: str,
    location: str | None,
) -> str:

    value = "|".join(
        [
            title,
            description,
            location or "",
        ]
    )

    return hashlib.sha256(
        value.encode("utf-8")
    ).hexdigest()
```

# 12. Ingestion logic

This is the piece that turns crawling into indexing.

Pseudo-flow:

```text
fetch provider
      ↓
normalize
      ↓
calculate content hash
      ↓
existing job?
   /        \
 no         yes
 ↓           ↓
insert     hash changed?
             /     \
           yes      no
            ↓        ↓
         snapshot   update last_seen
```

### `app/pipeline/ingest.py`

```python
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Job, JobSnapshot
from app.pipeline.normalize import (
    content_hash,
    html_to_text,
)
from app.sources.base import NormalizedJob


async def upsert_job(
    session: AsyncSession,
    company_id: int,
    source: str,
    incoming: NormalizedJob,
) -> str:

    description = html_to_text(
        incoming.description
    )

    normalized_hash = content_hash(
        incoming.title,
        description,
        incoming.location,
    )

    result = await session.execute(
        select(Job).where(
            Job.source == source,
            Job.external_id
                == incoming.external_id,
        )
    )

    existing = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)

    if existing is None:

        job = Job(
            company_id=company_id,

            source=source,

            external_id=incoming.external_id,

            title=incoming.title,

            description=description,

            location=incoming.location,

            workplace_type=(
                incoming.workplace_type
            ),

            department=incoming.department,

            team=incoming.team,

            employment_type=(
                incoming.employment_type
            ),

            salary_currency=(
                incoming.salary_currency
            ),

            salary_min=incoming.salary_min,

            salary_max=incoming.salary_max,

            salary_interval=(
                incoming.salary_interval
            ),

            job_url=incoming.job_url,

            apply_url=incoming.apply_url,

            posted_at=incoming.posted_at,

            source_updated_at=(
                incoming.source_updated_at
            ),

            status="OPEN",

            first_seen_at=now,

            last_seen_at=now,

            content_hash=normalized_hash,
        )

        session.add(job)

        await session.flush()

        return "ADDED"

    changed = (
        existing.content_hash
        != normalized_hash
    )

    if changed:

        snapshot = JobSnapshot(
            job_id=existing.id,

            title=existing.title,

            description=existing.description,

            location=existing.location,

            workplace_type=(
                existing.workplace_type
            ),

            salary_min=existing.salary_min,

            salary_max=existing.salary_max,

            content_hash=(
                existing.content_hash
            ),
        )

        session.add(snapshot)

    existing.title = incoming.title
    existing.description = description
    existing.location = incoming.location

    existing.workplace_type = (
        incoming.workplace_type
    )

    existing.department = (
        incoming.department
    )

    existing.team = incoming.team

    existing.salary_min = incoming.salary_min
    existing.salary_max = incoming.salary_max

    existing.salary_currency = (
        incoming.salary_currency
    )

    existing.job_url = incoming.job_url
    existing.apply_url = incoming.apply_url

    existing.source_updated_at = (
        incoming.source_updated_at
    )

    existing.last_seen_at = now
    existing.content_hash = normalized_hash

    existing.status = "OPEN"

    return "UPDATED" if changed else "UNCHANGED"
```

# 13. Detect closed jobs

This is one of the most important pieces.

Suppose yesterday:

```text
Company X → 182 jobs
```

Today:

```text
Company X → 179 jobs
```

You can't simply mark three arbitrary records closed.

Instead, during a crawl collect the IDs actually returned:

```python
seen_ids = set()

for job in jobs:
    seen_ids.add(job.external_id)
    await upsert_job(...)
```

Then:

```sql
UPDATE jobs
SET
    status = 'CLOSED',
    closed_at = NOW()
WHERE
    company_id = :company_id
    AND status = 'OPEN'
    AND source = :source
    AND external_id NOT IN (...seen_ids...);
```

For large crawls, do this with a temporary table or PostgreSQL array rather than building a giant SQL `NOT IN`.

# 14. Company configuration

Don't hard-code companies inside the crawler.

Put them in Postgres:

```text
companies
-------------------------------------------------------------
name              ats          ats_identifier
-------------------------------------------------------------
Anthropic         greenhouse   anthropic
OpenAI             greenhouse   openai
Example            lever        example
Another            ashby       another
```

Then your crawler is generic:

```python
async def crawl_company(company):

    if company.ats == "greenhouse":
        source = GreenhouseSource(
            company.ats_identifier
        )

    elif company.ats == "lever":
        source = LeverSource(
            company.ats_identifier
        )

    elif company.ats == "ashby":
        source = AshbySource(
            company.ats_identifier
        )

    else:
        raise ValueError(
            f"Unsupported ATS: {company.ats}"
        )

    jobs = await source.fetch_jobs()

    for job in jobs:
        await upsert_job(
            session=session,
            company_id=company.id,
            source=company.ats,
            incoming=job,
        )
```

# 15. Daily crawler

For the first version, you don't even need Celery.

Use cron.

```bash
0 2 * * * /usr/bin/python /app/scripts/crawl.py
```

And:

```python
async def main():

    companies = await get_active_companies()

    for company in companies:

        try:

            await crawl_company(
                company
            )

        except Exception as exc:

            logger.exception(
                "Failed crawling %s",
                company.name,
            )

            await record_failure(
                company,
                exc,
            )
```

Later, when you're crawling thousands of companies, move to:

```text
scheduler
    ↓
queue
    ↓
worker pool
    ├── Greenhouse worker
    ├── Lever worker
    ├── Ashby worker
    └── Workday worker
```

# 16. Seed your first companies

For an MVP, don't attempt to automatically discover every company.

Create a CSV:

```csv
name,ats,ats_identifier,careers_url
Anthropic,greenhouse,anthropic,https://www.anthropic.com/careers
ExampleCo,lever,exampleco,https://jobs.lever.co/exampleco
AnotherCo,ashby,anotherco,https://jobs.ashbyhq.com/anotherco
```

Then:

```python
import csv

from sqlalchemy import insert


async def seed(path: str):

    with open(path) as f:

        rows = csv.DictReader(f)

        for row in rows:

            await session.execute(
                insert(Company).values(
                    name=row["name"],
                    slug=row["name"].lower(),
                    ats=row["ats"],
                    ats_identifier=(
                        row["ats_identifier"]
                    ),
                    careers_url=(
                        row["careers_url"]
                    ),
                )
            )

    await session.commit()
```

Start with **50 companies**, make the crawler reliable, then go to 500.

# 17. Searching the database

Now you already have something useful.

Example:

```sql
SELECT
    j.title,
    c.name,
    j.location,
    j.job_url,
    j.first_seen_at
FROM jobs j
JOIN companies c
    ON c.id = j.company_id
WHERE
    j.status = 'OPEN'
    AND j.first_seen_at >= NOW() - INTERVAL '24 hours'
ORDER BY
    j.first_seen_at DESC;
```

You have just built:

> **"Show me every job that appeared on my tracked companies' career pages in the last 24 hours."**

That's already a useful product.

# 18. Keyword matching

Before adding an LLM, I'd build deterministic filtering.

For example:

```sql
SELECT *
FROM jobs
WHERE status = 'OPEN'
AND (
    title ILIKE '%software engineer%'
    OR title ILIKE '%backend engineer%'
    OR title ILIKE '%distributed systems%'
)
AND (
    description ILIKE '%Kafka%'
    OR description ILIKE '%Java%'
    OR description ILIKE '%AWS%'
);
```

But this gets ugly quickly.

That is where full-text and vectors become valuable.

# 19. Add pgvector

Your profile can eventually be:

```text
Senior software/backend engineer.
Java, Kafka, AWS, distributed systems,
databases, data platforms, AI infrastructure.
Interested in Staff/Senior roles in the Bay Area
or remote US.
```

Generate an embedding:

```python
profile_embedding = get_embedding(profile_text)
```

Generate one for each job:

```python
job_embedding = get_embedding(
    f"""
    {job.title}

    {job.description}

    {job.location}
    """
)
```

Store it in:

```sql
jobs.embedding
```

Then:

```sql
SELECT
    title,
    location,
    job_url,
    1 - (
        embedding <=> :profile_embedding
    ) AS similarity
FROM jobs
WHERE status = 'OPEN'
ORDER BY embedding <=> :profile_embedding
LIMIT 50;
```

Now you're getting semantic matching instead of:

> "Does the job description literally contain Kafka?"

# 20. Then add an LLM — not before

I would use the LLM only on the top 50–100 candidates.

For example:

```text
             20,000 jobs
                  ↓
            SQL filtering
                  ↓
             5,000 jobs
                  ↓
           vector search
                  ↓
              100 jobs
                  ↓
          LLM evaluation
                  ↓
             top 10 jobs
```

Prompt it with structured data:

```text
Evaluate this job against the candidate profile.

Candidate:
- Java
- Kafka
- AWS
- distributed systems
- database systems
- backend infrastructure

Job:
Senior Software Engineer, Data Platform
...

Return:
1. score 0-100
2. strong_matches
3. missing_requirements
4. reasons
```

Don't send 5,000 jobs to an LLM every night.

# 21. Your daily workflow

Ultimately the system becomes:

```text
02:00
  │
  ├── Crawl 500 companies
  │
  ├── Normalize 20K postings
  │
  ├── Detect changes
  │
  ├── Mark closed jobs
  │
  ├── Generate embeddings for new/changed jobs
  │
  ├── Find jobs matching your profile
  │
  └── Send digest
          │
          ↓
       07:00 AM

"8 jobs worth looking at today"
```

And because you store history, you can eventually do things like:

```text
Company X
────────────────────────
Engineering jobs:       84
New this week:          21
Closed this week:       14
Net change:             +7

AI/ML roles:            18
Staff+ roles:            9
Remote roles:           31
```

That is where you're moving from **"job scraper"** to **"hiring intelligence system."**

---

## One architectural change I'd make from the earlier design

I would **not** put the embeddings and all the enrichment into the crawler itself.

Keep these separate:

```text
                    CRAWLER
                       │
                       ↓
                Raw/normalized jobs
                       │
                       ↓
                  PostgreSQL
                       │
            ┌──────────┴──────────┐
            ↓                     ↓
       ENRICHMENT              SEARCH
            ↓                     ↓
   skills/location/etc.      user queries
            │                     │
            └──────────┬──────────┘
                       ↓
                    RANKER
                       ↓
                    ALERTS
```

That gives you a system where a broken embedding provider doesn't prevent tomorrow's jobs from being crawled.

### MVP stack I'd actually use

```text
Python 3.12
FastAPI
httpx
SQLAlchemy 2
PostgreSQL 16
pgvector
Alembic
Docker
cron initially
S3 only if you later store raw payloads
Redis/Celery only when scale requires it
```

The provider APIs are enough to get your first ingestion system running without scraping rendered HTML: Greenhouse documents public GET access to its Job Board API, Lever exposes published postings with pagination and structured fields, and Ashby exposes a public postings feed with optional compensation. ([developer.greenhouse.io](https://developer.greenhouse.io/job-board.html?utm_source=chatgpt.com))

A particularly important next step is **company/ATS discovery**. The crawler above assumes you already know that `Anthropic → greenhouse → anthropic`. The hard part of getting toward Dreamwork scale is building the table that discovers and maintains those mappings. That's where I'd focus next rather than making the crawler more complicated.
