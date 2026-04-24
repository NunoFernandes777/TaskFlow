# DEVOPS

## Objectif
TaskFlow a ete prepare pour une execution reproductible en local avec Docker Compose, une verification continue avec GitHub Actions, et un deploiement sur deux namespaces Kubernetes distincts.

## Proposition de repartition en binome
1. Binome A: containerisation locale, hygiene Docker, qualite backend, pipeline GitHub Actions.
2. Binome B: manifests Kubernetes, strategie de deploiement staging/production, validation applicative et documentation.

Cette separation limite les conflits de fichiers: `backend/`, `frontend/`, `docker-compose.yml` et `.github/workflows/ci.yml` d'un cote, `k8s/` et `DEVOPS.md` de l'autre.

## Architecture retenue
1. `frontend`: image `nginx:alpine`, sert les assets statiques et reverse-proxy `/api` vers le backend.
2. `backend`: image Node.js alpine multi-stage, dependances de production seulement, execution en utilisateur non-root, healthcheck HTTP integre.
3. `cache`: image `redis:7-alpine`, persistance via volume Docker nomme ou PVC Kubernetes.

### Flux reseau
1. En local, seul le frontend est publie sur l'hote.
2. Le backend n'expose pas de port sur l'hote; il reste joignable par le frontend sur `frontend_net`.
3. Redis n'est joignable que par le backend via `backend_net` en Docker, puis via `ClusterIP` + `NetworkPolicy` en Kubernetes.

## Containerisation

### Backend
- Fichier: `backend/Dockerfile`
- Multi-stage avec `ARG NODE_BASE_IMAGE` pour comparer facilement plusieurs bases.
- `npm ci --omit=dev` dans l'etape `deps`.
- Image finale minimale avec `node_modules` de production uniquement.
- Utilisateur applicatif `taskflow`.
- `HEALTHCHECK` sur `GET /health`.
- Labels OCI pour la tracabilite.

### Frontend
- Fichier: `frontend/Dockerfile`
- Base `nginx:alpine`.
- Configuration Nginx injectee via template pour accepter `API_UPSTREAM`.
- `HEALTHCHECK` sur `/nginx-health`.

### Docker Compose
- Fichier: `docker-compose.yml`
- Trois services: `frontend`, `backend`, `cache`.
- Volume nomme `redis-data`.
- Deux reseaux: `frontend_net` et `backend_net` (`internal: true`).
- `restart: unless-stopped` sur tous les services.
- `depends_on` avec attente du healthcheck Redis pour le backend.

### Variables d'environnement
- Fichier modele: `.env.example`
- Variables runtime:
  - `APP_ENV`
  - `APP_VERSION`
  - `PORT`
  - `REDIS_URL`
- Variables Compose:
  - `FRONTEND_PORT`
  - `BACKEND_NODE_IMAGE`

### Fichiers exclus du contexte Docker
- Fichier: `.dockerignore`
- Exclusions principales: `.git`, `.env`, `node_modules`, `*.log`.

## Commandes locales

### Lancement
```bash
cp .env.example .env
docker compose up --build
```

### Test de persistance Redis
```bash
docker compose up --build -d
curl -X POST http://localhost:8080/api/tasks -H "Content-Type: application/json" -d "{\"title\":\"Verifier la persistance\"}"
docker compose down
docker compose up -d
curl http://localhost:8080/api/tasks
```

Le volume nomme `redis-data` conserve les donnees apres `docker compose down`.

### Qualite backend
```bash
cd backend
npm ci
npm test
npm run lint
```

## CI/CD GitHub Actions
- Fichier: `.github/workflows/ci.yml`

### Pipeline
1. `backend-quality`
   - installe Node 20
   - lance `npm ci`, `npm test`, `npm run lint`
2. `security-scan`
   - build des images backend et frontend
   - scan Trivy en severites `HIGH,CRITICAL`
   - publication des rapports SARIF dans GitHub Security
3. `publish-images`
   - build et push vers GHCR sur `main`
   - tags pushes: `sha` et `latest`
4. `deploy-staging`
   - `kubectl apply -f k8s/staging`
   - mise a jour des images vers le tag du commit
5. `deploy-production`
   - meme mecanisme vers `k8s/production`
   - peut etre protegee par l'environnement GitHub `production`

### Secrets GitHub attendus
1. `KUBE_CONFIG_STAGING`: kubeconfig staging encode en base64.
2. `KUBE_CONFIG_PRODUCTION`: kubeconfig production encode en base64.

Le `GITHUB_TOKEN` suffit pour pousser sur GHCR si le repository autorise les packages.

## Kubernetes

### Staging
- Namespace: `taskflow-staging`
- 1 replica frontend
- 1 replica backend
- 1 replica Redis
- PVC Redis: `1Gi`

### Production
- Namespace: `taskflow-production`
- 2 replicas frontend
- 2 replicas backend
- 1 replica Redis
- PVC Redis: `5Gi`

### Manifests fournis par environnement
1. `namespace.yaml`
2. `configmap.yaml`
3. `secret.yaml`
4. `persistentvolumeclaim.yaml`
5. `deployment.yaml`
6. `service.yaml`
7. `networkpolicy.yaml`

### Exposition reseau
1. `taskflow-frontend`: `LoadBalancer`
2. `taskflow-backend`: `ClusterIP`
3. `taskflow-redis`: `ClusterIP`

## Choix de l'image backend
Choix final cible: `node:20-alpine`

Raisons:
1. version LTS recente pour rester aligne avec le runtime demande
2. empreinte reduite par rapport aux images non-alpine
3. surface d'attaque generalement plus faible qu'une image complete

### Comparaison demandee
Le Docker daemon n'etait pas disponible dans cet environnement de travail, donc les mesures locales `docker images` et `trivy image` n'ont pas pu etre executees ici. Le Dockerfile accepte toutefois un `ARG NODE_BASE_IMAGE` pour lancer la comparaison des variantes des que Docker est demarre:

```bash
docker build -f backend/Dockerfile --build-arg NODE_BASE_IMAGE=node:18-alpine -t taskflow-backend:18-alpine .
docker build -f backend/Dockerfile --build-arg NODE_BASE_IMAGE=node:20-alpine -t taskflow-backend:20-alpine .
docker images taskflow-backend
trivy image taskflow-backend:18-alpine
trivy image taskflow-backend:20-alpine
```

Tableau a completer pendant la soutenance pratique:

| Base image | Taille | CVE HIGH/CRITICAL | Decision |
|------------|--------|-------------------|----------|
| `node:18-alpine` | a mesurer | a mesurer | comparaison |
| `node:20-alpine` | a mesurer | a mesurer | choix final |

## Verification effectuee dans cette session
1. `npm test` backend: OK
2. `npm run lint` backend: OK

## Points d'attention
1. Demarrer Docker Desktop avant les verifications d'image, Compose et Trivy local.
2. Remplir les secrets GitHub de kubeconfig avant d'activer le CD.
3. Si le cluster ne supporte pas `LoadBalancer`, remplacer le service frontend par `NodePort` ou ajouter un Ingress selon la plateforme.
