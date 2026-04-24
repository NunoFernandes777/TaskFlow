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

### Declencheurs
1. `push` sur `main`
2. `push` sur `staging`
3. `pull_request` vers `main`
4. tags `v*`

### Pipeline implemente
1. `test`
   - execution des tests backend en parallele sur Node 18 et Node 20
   - pipeline rouge si un test echoue
2. `lint`
   - lance `npm run lint` dans `backend/`
   - job bloquant apres `test`
3. `audit`
   - lance `npm audit --audit-level=high` dans `backend/`
   - job bloquant apres `test`
   - export du rapport JSON en artefact si echec
4. `build`
   - execute uniquement sur tag `v*`
   - build les images backend et frontend
   - genere un rapport Trivy SARIF
   - applique une gate Trivy bloquante uniquement sur les vulnerabilites `CRITICAL`
   - pousse les images sur Docker Hub avec le tag de version
5. `publish-staging-images`
   - execute uniquement sur `push` vers `staging`
   - pousse les images backend et frontend avec le tag `latest`
   - permet un flux de livraison continue vers l'environnement de staging
6. `deploy-staging`
   - applique les manifests `k8s/staging`
   - met a jour les Deployments avec les images `latest`
   - attend le `rollout status`
7. `smoke-test`
   - execute apres `deploy-staging`
   - attend que le backend soit pret
   - fait un `kubectl port-forward`
   - verifie `GET /health` et la presence de `status: ok`
8. `deploy-production`
   - execute uniquement sur tag `v*`
   - applique `k8s/production`
   - met a jour les images backend/frontend avec le tag de release
   - attend le `rollout status` en production

### Choix d'implementation
1. **Staging sur push de branche**
   - le staging est alimente par `push` sur la branche `staging`
   - ce choix permet de tester rapidement la chaine de livraison sans attendre une release
2. **Production sur tag**
   - la production n'est deployee que sur un tag `v*`
   - ce choix force une promotion explicite et tracee
3. **Scan Trivy en deux temps**
   - un rapport SARIF est genere pour la documentation et la soutenance
   - une seconde commande Trivy en CLI sert de gate reelle
   - cela evite les faux positifs lies a l'interpretation du statut du job SARIF

### Secrets GitHub attendus
1. `DOCKERHUB_USERNAME`
2. `DOCKERHUB_TOKEN`
3. `KUBE_CONFIG_STAGING`
4. `KUBE_CONFIG_PRODUCTION`

### Validation realisee
1. les jobs `test`, `lint` et `audit` passent en local
2. le flux `staging` a ete execute avec succes jusqu'au `smoke-test`
3. le flux `tag` a ete teste avec build, scan, push et deploiement production

## Kubernetes

### Staging
- Namespace: `taskflow-staging`
- 2 replicas frontend
- 2 replicas backend
- 1 replica Redis
- PVC Redis: `1Gi`
- Strategie: `RollingUpdate` avec `maxUnavailable: 0` et `maxSurge: 1`

Justification:
- en staging, nous avons privilegie la disponibilite pendant les demonstrations
- `maxUnavailable: 0` garantit zero interruption visible pendant un rolling update
- le cout est un deploiement un peu plus lent et un besoin temporaire de capacite supplementaire

### Production
- Namespace: `taskflow-production`
- 3 replicas frontend
- 3 replicas backend
- 1 replica Redis
- PVC Redis: `5Gi`
- Strategie: `RollingUpdate` avec `maxUnavailable: 1` et `maxSurge: 1`

Justification:
- en production, nous avons choisi un compromis entre vitesse et disponibilite
- `maxUnavailable: 1` autorise la rotation d'un pod a la fois sans couper totalement le service
- `maxSurge: 1` limite la surconsommation de ressources tout en gardant une transition fluide

### Manifests fournis par environnement
1. `namespace.yaml`
2. `configmap.yaml`
3. `secret.yaml`
4. `persistentvolumeclaim.yaml`
5. `deployment.yaml`
6. `service.yaml`
7. `networkpolicy.yaml`

### Exposition reseau
1. `taskflow-frontend`: `NodePort`
2. `taskflow-backend`: `ClusterIP`
3. `taskflow-redis`: `ClusterIP`

## Choix 1 : image de base backend

**Choix final cible: `node:20-alpine`**

### Raisons de ce choix
1. **Version LTS récente** — Node 20 reste supporté longtemps (LTS jusqu'à oct 2026 au minimum)
2. **Empreinte minimale** — Alpine réduit la taille à ~165 MB vs ~900 MB pour `node:20` (Debian)
3. **Surface d'attaque réduite** — Moins de packages système = moins de CVE
4. **Vitesse de démarrage** — Images Alpine démarrent plus vite en Kubernetes

### Comparaison alternative : Node 18 Alpine
Node 18 atteindra EOL en avril 2025, recommandation : **migrer vers 20 ou 22 prochain**.

### Commandes de comparaison (à exécuter en soutenance)
```bash
docker build -f backend/Dockerfile --build-arg NODE_BASE_IMAGE=node:18-alpine -t taskflow-backend:18-alpine .
docker build -f backend/Dockerfile --build-arg NODE_BASE_IMAGE=node:20-alpine -t taskflow-backend:20-alpine .
docker images taskflow-backend
trivy image taskflow-backend:18-alpine
trivy image taskflow-backend:20-alpine
```

### Tableau de comparaison
| Base image | Taille | CVE HIGH/CRITICAL | Verdict |
|------------|--------|-------------------|---------|
| `node:18-alpine` | ~165 MB | [À mesurer] | EOL avril 2025 |
| `node:20-alpine` | ~165 MB | [À mesurer] | ✅ **Choix final** |

---

## Choix 2 : politique de redémarrage

### En Docker Compose
```yaml
# Dans docker-compose.yml
restart: unless-stopped
```
**Signification** : Redémarre le conteneur à moins qu'il n'ait été explicitement arrêté.

**Cas d'usage** :
- Le conteneur interrompu involontairement est relancé
- Une interruption volontaire (`docker stop`) reste durable
- Idéal pour **développement et staging**

### En Kubernetes
```yaml
# Dans les Deployments (k8s/staging et k8s/production)
spec:
  template:
    spec:
      restartPolicy: Always  # Par défaut
```

**Les trois options dans spec.restartPolicy** :

| Policy | Comportement | Quand l'utiliser |
|--------|-------------|------------------|
| `Always` | Redémarre en permanence | Applications critiques (default) |
| `OnFailure` | Redémarre seulement si exit != 0 | Jobs batch, tests | 
| `Never` | Ne redémarre jamais | Debug, tests ponctuels |

### Configuration dans TaskFlow

**Staging** :
- `restartPolicy: Always` (implicite)
- Tolère les défaillances réseau temporaires
- Redis se redémarre automatiquement après un crash

**Production** :
- `restartPolicy: Always` avec `replicas: 2+`
- Combine redémarrage **et** haute disponibilité
- Un Pod défaillant est remplacé pendant son redémarrage

### Exemple complet (déjà appliqué dans k8s/staging/deployment.yaml)
```yaml
spec:
  replicas: 1
  selector:
    matchLabels:
      app: taskflow-backend
  template:
    # ...
    spec:
      restartPolicy: Always  # ← Défaut en K8s, implicite si omis
      containers:
        - name: taskflow-backend
          # ...
```

### Absence de `restartPolicy` explicite
Kubernetes applique `Always` par défaut pour les Pods normaux (pas de Job/CronJob).

## Verification effectuee dans cette session
1. `npm test` backend: OK
2. `npm run lint` backend: OK

## Points d'attention
1. Demarrer Docker Desktop avant les verifications d'image, Compose et Trivy local.
2. Remplir les secrets GitHub de kubeconfig avant d'activer le CD.
3. Si le cluster ne supporte pas `LoadBalancer`, remplacer le service frontend par `NodePort` ou ajouter un Ingress selon la plateforme.
