# Protogen Configurator

A tool for configuring LED matrixes for Protogens.

Public instance and documentation can be found at https://protogen-configurator.zeeraa.net/

## Running with Docker

### Docker Compose (recommended)

```bash
docker compose up -d
```

This uses the provided `docker-compose.yml`, which runs the container on port 80.

### Docker CLI

```bash
docker run -d --restart unless-stopped -p 80:80 zeeraa/protogen-configurator
```

Change the host port (left side of `-p`) if port 80 is already in use.
