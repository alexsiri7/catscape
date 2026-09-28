# Static hosting for Railway: serve index.html with Caddy on $PORT
FROM caddy:2-alpine
COPY index.html /srv/index.html
CMD ["sh", "-c", "caddy file-server --root /srv --listen :${PORT:-8080}"]
