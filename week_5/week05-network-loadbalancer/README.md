# Multi-Subnet Network Topology and Load Balancer

An Nginx load balancer in front of two Flask backends. The backends live on an isolated private network and can be reached only through Nginx.

## Architecture topology and overview

```
                  Host / Internet
                        |
              8080 (HTTP)  8443 (HTTPS)
                        |
   +--------------------v---------------------+
   |  public_subnet   172.28.10.0/24          |
   |                                          |
   |            +-------------+               |
   |            |    nginx    |               |
   |            |   (L7 LB)   |               |
   +------------+------+------+---------------+
                       | dual-homed
   +-------------------+----------------------+
   |  private_subnet  172.28.20.0/24          |
   |  (internal: true, no route outside)      |
   |                                          |
   |      +-----------+     +-----------+     |
   |      | backend1  |     | backend2  |     |
   |      |  :5000    |     |  :5000    |     |
   |      +-----------+     +-----------+     |
   +------------------------------------------+
```

- Only `nginx` is attached to both networks.
- The backends use `expose: 5000` only. They have no `ports:` mapping, so nothing is published to the host.
- `private_subnet` is `internal: true`, so it has no route to the outside world.
- Nginx finds the backends by Docker service name (`backend1`, `backend2`), not by IP address.
- Load balancing is round robin (the Nginx default) at Layer 7.
- Ports are published as 8080 (HTTP) and 8443 (HTTPS) on the host to avoid privileged ports.

## Project files

```
docker-compose.yml     networks, services, healthchecks
nginx/Dockerfile       Nginx image with a self-signed certificate
nginx/nginx.conf       upstream pool, failover settings, TLS
backend/app.py         Flask app: / returns the hostname, /healthz returns 200
backend/Dockerfile     Python image running gunicorn as a non-root user
backend/requirements.txt
```

## Setup and execution guide

Run these from the project folder (the one that contains `docker-compose.yml`). Docker Desktop must be running.

```bash
docker compose up --build -d     # build and start
docker compose ps                # backends should show "healthy"
docker compose logs -f nginx     # watch the load balancer log
docker compose down              # stop and remove containers and networks
docker compose down --rmi local  # also remove the built images
```

Open http://localhost:8080 for HTTP, or https://localhost:8443 for HTTPS (self-signed certificate, so use `curl -k`).

## QA tests

**1. Round-robin distribution (10 requests)**
```bash
for i in {1..10}; do curl -s localhost:8080; done
```

**2. Failover and recovery**
```bash
docker stop backend1
for i in {1..10}; do curl -s -o /dev/null -w "%{http_code}\n" localhost:8080; done
docker start backend1
sleep 15
for i in {1..10}; do curl -s localhost:8080; done
```

**3. Network isolation (negative test)**
```bash
docker compose port backend1 5000                                   # no published port
curl --max-time 3 http://172.28.20.2:5000                           # times out from the host
docker compose exec nginx wget -qO- http://backend1:5000/healthz    # works from inside Nginx
```
Note: on macOS, `curl localhost:5000` is answered by AirPlay Receiver (`Server: AirTunes`), not by a container, so it is not a valid isolation test. The private container IP can be read from `docker compose logs nginx` (the `upstream` field).

**4. Health checks**
```bash
curl -i localhost:8080/lb-health      # load balancer health: 200 OK
curl -i localhost:8080/healthz        # backend health through the LB: 200 OK
docker compose logs nginx --tail 20   # shows which upstream served each request
```

## AI disclosure and prompt appendix

**AI tool used:** Claude

**Exact prompt submitted:**

```
Act as a senior network architect. Create a Docker Compose project with:

- Two networks: public_subnet and private_subnet (internal: true)
- One Nginx load balancer on both networks, exposing ports 80/443, with round-robin across the backends, Docker service names (no hardcoded IPs), and proxy_next_upstream, max_fails, and fail_timeout for failover
- Two Flask backends on private_subnet only, no host ports (use expose:), each returning its container hostname, with a /healthz endpoint and a Docker healthcheck

Give me docker-compose.yml, nginx.conf, the Flask app and Dockerfile, an ASCII topology diagram, commands to run and clean up, and test commands (10 curls, stopping one backend, a curl to a backend from the host that should fail).
```

**What the AI got right**
- Both networks were defined, and `private_subnet` uses `internal: true`.
- Only the Nginx service is on both networks.
- The backends use `expose:` with no `ports:` mapping, so there is no port leakage to the host.
- Nginx uses Docker service names, not hardcoded IPs.
- The upstream block has `max_fails` and `fail_timeout`, and the location block has `proxy_next_upstream` and connect timeouts.
- Each backend returns its hostname, has `/healthz`, and has a Docker healthcheck.

**What I had to fix**
Nothing in the configuration. I audited the output against the assignment checklist (port leakage, dual-homing, upstream configuration, balancing algorithm) and it already met every item. I changed no files after generation.

**Limitations I noticed while auditing and testing**
- Nginx uses passive health checks only. It detects a dead backend when a real request fails (one "upstream timed out" line in the log, then a retry on the other backend). Active health checks are not part of open-source Nginx.
- The prompt asked for ports 80/443. I publish them as 8080/8443 on the host.
- HTTPS uses a self-signed certificate, so browsers show a warning and curl needs `-k`.
- Testing `localhost:5000` on my Mac returned a response from macOS AirPlay (`Server: AirTunes`), not from my container. I used `docker compose port`, the private container IP, and a request from inside the Nginx container to prove isolation instead.

## QA test summary

- [x] Round robin: 10 consecutive requests alternated evenly between `backend1` and `backend2`.
- [x] Failover: with `backend1` stopped, all 10 requests returned HTTP 200 and none returned 502. The Nginx log showed one connection timeout to the stopped backend followed by a successful retry on `backend2`.
- [x] Recovery: after `docker start backend1`, both backends served requests again.
- [x] Isolation: `docker compose port backend1 5000` showed no published port. A request to the private container IP from the host timed out. A request from inside the Nginx container succeeded.
- [x] Health checks: `/lb-health` and `/healthz` both returned 200 OK, and `docker compose ps` showed both backends as healthy.
- [x] Browser DevTools: check the Network tab (status codes, headers) and confirm the Console is clean, then tick this box.