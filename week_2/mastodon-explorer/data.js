/* Architecture data for the Mastodon Architecture Explorer.
 * Every fact lists the source it was checked against. Anything that could not
 * be confirmed is recorded in VERIFICATION_LOG instead of being shown as fact. */
(function (root) {
  'use strict';

  var SRC = {
    scaling: { label: 'Mastodon docs: Scaling', url: 'https://docs.joinmastodon.org/admin/scaling/' },
    install: { label: 'Mastodon docs: Installing from source', url: 'https://docs.joinmastodon.org/admin/install/' },
    storage: { label: 'Mastodon docs: Object storage', url: 'https://docs.joinmastodon.org/admin/optional/object-storage/' },
    repo: { label: 'GitHub: mastodon/mastodon README', url: 'https://github.com/mastodon/mastodon' },
    article: { label: 'SoftwareMill: The architecture of Mastodon', url: 'https://softwaremill.com/the-architecture-of-mastodon/' },
    postService: { label: 'Source: post_status_service.rb', url: 'https://github.com/mastodon/mastodon/blob/main/app/services/post_status_service.rb' },
    worker: { label: 'Source: distribution_worker.rb', url: 'https://github.com/mastodon/mastodon/blob/main/app/workers/distribution_worker.rb' }
  };

  var LAYERS = [
    { id: 'edge', label: 'Clients and entry point' },
    { id: 'app', label: 'Application processes' },
    { id: 'data', label: 'Data and storage' },
    { id: 'fed', label: 'Federation' }
  ];

  var COMPONENTS = [
    {
      id: 'clients', layer: 'edge', name: 'Clients', tech: 'React + Redux web UI, third-party apps', optional: false,
      role: 'People use the built-in web UI or third-party apps. Both talk to the server through its APIs.',
      facts: [
        'The dynamic parts of the web UI use React and Redux.',
        'Mastodon is an OAuth2 provider and offers REST and Streaming APIs for third-party apps.'
      ],
      sources: [SRC.repo]
    },
    {
      id: 'proxy', layer: 'edge', name: 'Reverse proxy', tech: 'nginx', optional: false,
      role: 'Receives HTTPS traffic and forwards it to the web app or the streaming server.',
      facts: [
        'The install guide sets up nginx as the web server.',
        'Several streaming instances can run behind nginx with least_conn load balancing.',
        'Health checks: /health for the web app and /api/v1/streaming/health for streaming. Both should return HTTP 200 and OK.'
      ],
      sources: [SRC.install, SRC.scaling]
    },
    {
      id: 'web', layer: 'app', name: 'Web app', tech: 'Ruby on Rails, Puma', optional: false,
      role: 'The core of the system. Serves the REST API and web pages, and enforces the business rules for posting.',
      facts: [
        'A Ruby on Rails monolith with no microservices (per the SoftwareMill article).',
        'Puma settings: WEB_CONCURRENCY sets worker processes and MAX_THREADS sets threads per process. The docs say more processes are better than more threads.',
        'Runs as the mastodon-web service.'
      ],
      sources: [SRC.repo, SRC.scaling, SRC.install, SRC.article]
    },
    {
      id: 'streaming', layer: 'app', name: 'Streaming server', tech: 'Node.js (streaming/ directory)', optional: false,
      role: 'Keeps long-lived connections open so timelines and notifications update in real time.',
      facts: [
        'A separate Node.js server, not part of the Rails process.',
        'Runs as the mastodon-streaming service.',
        'Each instance uses at most DB_POOL database connections.'
      ],
      sources: [SRC.repo, SRC.scaling, SRC.install, SRC.article]
    },
    {
      id: 'sidekiq', layer: 'app', name: 'Sidekiq workers', tech: 'Sidekiq (Ruby, same codebase)', optional: false,
      role: 'Runs background jobs such as fan-out to feeds and delivery to other servers.',
      facts: [
        'Queues, in priority order: default, push, ingress, mailers, pull, scheduler, fasp.',
        'push delivers payloads to other servers, ingress handles incoming remote activity, and scheduler must run in only one process.',
        'A backed-up higher-priority queue can delay the others. You can run one Sidekiq process per queue.',
        'Runs as the mastodon-sidekiq service.'
      ],
      sources: [SRC.scaling, SRC.install]
    },
    {
      id: 'postgres', layer: 'data', name: 'PostgreSQL', tech: 'Relational database', optional: false,
      role: 'The source of truth for accounts, posts and relationships.',
      facts: [
        'Losing this data means starting over with a fresh instance (per the SoftwareMill article).',
        'Default connection limit is 100. PgBouncer in transaction pooling mode (with PREPARED_STATEMENTS=false) helps.',
        'Read replicas are supported from Mastodon 4.2 through REPLICA_* variables.'
      ],
      sources: [SRC.scaling, SRC.article]
    },
    {
      id: 'redis', layer: 'data', name: 'Redis', tech: 'In-memory store', optional: false,
      role: 'Holds home feeds, the Sidekiq job queues and streaming data.',
      facts: [
        'It does more than caching: feeds, queues and streaming all depend on it, so its data matters.',
        'You can run a separate cache instance (CACHE_REDIS_URL) and a separate Sidekiq instance (SIDEKIQ_REDIS_URL).',
        'Redis Sentinel provides high availability.',
        'Home feeds can be rebuilt, so they do not need to be persisted (per the SoftwareMill article).'
      ],
      sources: [SRC.scaling, SRC.article]
    },
    {
      id: 'storage', layer: 'data', name: 'Media storage', tech: 'Local disk or S3-compatible', optional: true,
      role: 'Stores uploaded images, video and avatars.',
      facts: [
        'The local file system is the default.',
        'S3-compatible object storage is enabled with S3_ENABLED=true. Examples listed: MinIO, Wasabi, DigitalOcean Spaces, Scaleway, Exoscale, Cloudflare R2.',
        'Object storage is optional but may be needed as an instance grows.'
      ],
      sources: [SRC.storage]
    },
    {
      id: 'search', layer: 'data', name: 'Search', tech: 'Elasticsearch', optional: true,
      role: 'Optional full-text search over posts you wrote, favorited or were mentioned in.',
      facts: [
        'Optional component (per the SoftwareMill article).',
        'The indexing step was not visible in post_status_service.rb, so the post trace below does not claim when it runs.'
      ],
      sources: [SRC.article, SRC.postService]
    },
    {
      id: 'federation', layer: 'fed', name: 'Remote servers', tech: 'ActivityPub over HTTP', optional: false,
      role: 'Other Mastodon (and ActivityPub) servers. Posts are delivered between servers instead of living on one central site.',
      facts: [
        'Mastodon is based on ActivityPub, so it federates with other servers.',
        'Per the SoftwareMill article, a post needs one local database write plus one network call per distinct follower server. The receiving server queues an ingress job.'
      ],
      sources: [SRC.repo, SRC.article]
    }
  ];

  /* What the first AI draft assumed versus what the sources say. */
  var VERIFICATION_LOG = [
    {
      assumption: 'Redis is only a cache.',
      finding: 'Redis also stores the Sidekiq job queues and supports streaming. Its data matters, although home feeds can be rebuilt.',
      outcome: 'Corrected',
      source: SRC.scaling
    },
    {
      assumption: 'Real-time timelines are served by the Rails app.',
      finding: 'Streaming is a separate Node.js server with its own service (mastodon-streaming).',
      outcome: 'Corrected',
      source: SRC.install
    },
    {
      assumption: 'Background work goes through one generic queue.',
      finding: 'Sidekiq has named queues in priority order: default, push, ingress, mailers, pull, scheduler, fasp.',
      outcome: 'Corrected',
      source: SRC.scaling
    },
    {
      assumption: 'Version requirements are the same everywhere.',
      finding: 'The README lists minimums (PostgreSQL 14+, Redis 7.0+, Node.js 22+, Ruby 3.3+). The install guide uses newer versions (PostgreSQL 18, Node.js 24.x). Both are right: minimum versus recommended setup.',
      outcome: 'Corrected',
      source: SRC.repo
    },
    {
      assumption: 'The SoftwareMill article is a complete, official source.',
      finding: 'The author says they are new to the codebase, and the article never names ActivityPub. The repository README confirms ActivityPub.',
      outcome: 'Cross-checked',
      source: SRC.article
    },
    {
      assumption: 'DistributionWorker runs on a specific queue.',
      finding: 'The worker file sets no queue, and where it is configured was not visible. The trace does not name a queue for it.',
      outcome: 'Left out (not verified)',
      source: SRC.worker
    },
    {
      assumption: 'Posting a status only saves it and notifies followers.',
      finding: 'PostStatusService also checks media, mentions and antispam rules, supports an idempotency key, saves in a transaction, then enqueues several jobs (distribution, federation, link crawling, and email for public posts).',
      outcome: 'Corrected',
      source: SRC.postService
    }
  ];

  root.MASTODON_DATA = {
    SOURCES: SRC,
    LAYERS: LAYERS,
    COMPONENTS: COMPONENTS,
    VERIFICATION_LOG: VERIFICATION_LOG
  };
})(typeof window !== 'undefined' ? window : globalThis);
