# Reverse Proxy Setup (HTTPS + Optional Basic Auth)

When deployed remotely, run the app behind a reverse proxy. Below are minimal configs for **Caddy** and **nginx**.

---

## Caddy (recommended — auto-HTTPS)

Create a `Caddyfile` in the same directory as `docker-compose.yml`:

```caddyfile
your-domain.example.com {
    # Optional basic auth — comment out if not needed
    basicauth /* {
        # Generate hash: caddy hash-password
        admin $2a$14$<bcrypt-hash-here>
    }

    reverse_proxy app:3000 {
        # WebSocket support is automatic in Caddy
    }
}
```

Add Caddy to `docker-compose.yml`:

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app

volumes:
  caddy_data:
  caddy_config:
```

---

## nginx

```nginx
server {
    listen 443 ssl;
    server_name your-domain.example.com;

    ssl_certificate     /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;

    # Optional basic auth
    auth_basic "AI Workspace";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

---

## Security Notes

- Always run behind HTTPS when accessible remotely.
- Use a strong `MASTER_PASSWORD` — it protects all stored API keys.
- Basic auth over HTTPS is acceptable for personal single-user use.
- For stronger auth, add an OAuth2 proxy (e.g. `oauth2-proxy` container).
