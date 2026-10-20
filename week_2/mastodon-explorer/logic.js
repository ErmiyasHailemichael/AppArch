/* Pure logic for the post trace: input validation and step building.
 * No DOM access here, so it can be unit tested with `node --test`. */
(function (root) {
  'use strict';

  var POST_LIMIT = 500;     // Mastodon's default character limit (servers can change it)
  var MAX_SERVERS = 10000;

  function countChars(text) {
    return Array.from(String(text == null ? '' : text)).length;
  }

  function validateInput(text, serversRaw) {
    var errors = {};
    var trimmed = String(text == null ? '' : text).trim();
    var length = countChars(trimmed);

    if (!trimmed) {
      errors.text = 'Write something first. A post cannot be empty.';
    } else if (length > POST_LIMIT) {
      errors.text = 'This post is ' + (length - POST_LIMIT) + ' characters over the ' + POST_LIMIT + ' character limit.';
    }

    var raw = String(serversRaw == null ? '' : serversRaw).trim();
    var servers = NaN;
    if (!raw) {
      errors.servers = 'Enter a whole number from 0 to ' + MAX_SERVERS + '.';
    } else if (!/^\d+$/.test(raw) || Number(raw) > MAX_SERVERS) {
      errors.servers = 'Use a whole number from 0 to ' + MAX_SERVERS + ' (no decimals, signs or letters).';
    } else {
      servers = Number(raw);
    }

    return {
      ok: Object.keys(errors).length === 0,
      errors: errors,
      value: { text: trimmed, length: length, servers: servers }
    };
  }

  var FAILURES = {
    none: 'Everything healthy',
    sidekiq: 'Sidekiq queues are backed up',
    redis: 'Redis is unavailable',
    postgres: 'PostgreSQL is unavailable'
  };

  /* Returns the ordered steps of posting a status. status is one of:
   * ok, delayed, blocked, skipped. */
  function buildTrace(input, failure, isPublic) {
    failure = FAILURES[failure] ? failure : 'none';
    var servers = input.servers;
    var halted = false;

    function mark(base, kind) {
      // kind: 'sync' runs while the user waits, 'async' runs in the background
      if (halted) return 'skipped';
      if (kind === 'async' && failure === 'sidekiq') return 'delayed';
      return base;
    }

    var steps = [];

    steps.push({
      id: 'validate', component: 'web', async: false,
      title: 'Web app validates the post',
      detail: 'Rails (Puma) checks media, mentions and antispam rules. If the client sent an idempotency key, a Redis lock prevents duplicate posts.',
      status: 'ok'
    });

    var dbStatus = failure === 'postgres' ? 'blocked' : 'ok';
    if (dbStatus === 'blocked') halted = true;
    steps.push({
      id: 'save', component: 'postgres', async: false,
      title: 'Post is saved in PostgreSQL',
      detail: 'The status is written in a database transaction. PostgreSQL is the source of truth.',
      status: dbStatus
    });

    var queueStatus = halted ? 'skipped' : (failure === 'redis' ? 'blocked' : 'ok');
    if (queueStatus === 'blocked') halted = true;
    steps.push({
      id: 'enqueue', component: 'redis', async: false,
      title: 'Background jobs are queued in Redis',
      detail: 'The web app enqueues distribution, federation and link-crawl jobs, then responds to the user. The user does not wait for the steps below.',
      status: queueStatus
    });

    steps.push({
      id: 'fanout', component: 'sidekiq', async: true,
      title: 'Sidekiq adds the post to home feeds',
      detail: 'DistributionWorker locks the status in Redis and calls FanOutOnWriteService. Followers’ home feeds live in Redis.',
      status: mark('ok', 'async')
    });

    steps.push({
      id: 'stream', component: 'streaming', async: true,
      title: 'Streaming server updates open timelines',
      detail: 'Followers with an open timeline see the new post in real time over a long-lived connection.',
      status: mark('ok', 'async')
    });

    var fedDetail;
    var fedStatus;
    if (servers === 0) {
      fedDetail = 'No remote servers have followers, so nothing is delivered outside this server.';
      fedStatus = 'skipped';
    } else {
      fedDetail = 'One ActivityPub delivery per remote server with followers: about ' + servers + ' delivery job' + (servers === 1 ? '' : 's') + ' on the push queue. Each remote server then queues an ingress job.';
      fedStatus = mark('ok', 'async');
    }
    steps.push({
      id: 'federate', component: 'federation', async: true,
      title: 'Remote servers receive the post',
      detail: fedDetail,
      status: fedStatus
    });

    var mailDetail = isPublic
      ? 'For a public top-level post, if email subscriptions are enabled, EmailDistributionWorker is scheduled about 5 minutes later.'
      : 'Email notifications are only scheduled for public posts, so this step does not run.';
    steps.push({
      id: 'email', component: 'sidekiq', async: true,
      title: 'Email notifications are scheduled',
      detail: mailDetail,
      status: isPublic ? mark('ok', 'async') : 'skipped'
    });

    return steps;
  }

  var SUMMARIES = {
    none: 'The user gets a response after the first three steps. The rest happens in the background, so followers see the post a moment later (eventual consistency).',
    sidekiq: 'The post is saved and the user sees success, but fan-out and delivery wait in the queues. Followers see it late. This is the cost of asynchronous work. Per the docs, a backed-up higher-priority queue can delay other queues.',
    redis: 'Expected behaviour from the docs (not tested on a live server): feeds, queues and streaming depend on Redis, so the post may be stored but cannot be distributed.',
    postgres: 'Expected behaviour: PostgreSQL is the source of truth, so nothing is saved and nothing downstream runs.'
  };

  function summarize(failure) {
    return SUMMARIES[failure] || SUMMARIES.none;
  }

  var api = {
    POST_LIMIT: POST_LIMIT,
    MAX_SERVERS: MAX_SERVERS,
    FAILURES: FAILURES,
    countChars: countChars,
    validateInput: validateInput,
    buildTrace: buildTrace,
    summarize: summarize
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ArchLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
