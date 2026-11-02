FROM nginx:1.27-alpine

# Self-signed certificate so port 443 works for this demo
RUN apk add --no-cache openssl \
 && mkdir -p /etc/nginx/certs \
 && openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout /etc/nginx/certs/selfsigned.key \
      -out /etc/nginx/certs/selfsigned.crt \
      -subj "/CN=localhost"

COPY nginx.conf /etc/nginx/nginx.conf
