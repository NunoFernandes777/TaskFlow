# TaskFlow

[![CI/CD Pipeline](https://github.com/[owner]/taskflow/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/[owner]/taskflow/actions/workflows/ci.yml)

Application web de gestion de tâches. Interface Kanban avec backend Node.js et persistance Redis.

## Stack technique

| Couche   | Technologie              | Rôle                                   |
|----------|--------------------------|----------------------------------------|
| Frontend | HTML/CSS/JS vanilla      | Interface Kanban, servie par Nginx     |
| Backend  | Node.js (sans framework) | API REST — logique métier              |
| Stockage | Redis 7                  | Persistance des tâches et stats        |

## Structure du projet

```
taskflow/
├── frontend/
│   └── index.html          ← interface Kanban
├── backend/
│   ├── server.js           ← API REST
│   ├── server.test.js      ← tests unitaires
│   └── package.json
├── .env.example
├── .gitignore
└── README.md
```

## Lancer le projet en local

### Prérequis

- Node.js 18+
- Docker Desktop démarré (pour lancer Redis)

### Lancer Redis

Redis tourne dans un container Docker — pas besoin de l'installer sur ta machine.

```bash
docker run -d -p 6379:6379 --name redis-dev redis:7-alpine
```

Pour vérifier que Redis tourne :

```bash
docker ps
# → redis-dev doit être listé en "Up"
```

Pour arrêter Redis :

```bash
docker stop redis-dev && docker rm redis-dev
```

### 1. Cloner le projet

```bash
git clone https://github.com/[FORMATEUR]/taskflow.git
cd taskflow
```

### 2. Créer le fichier de configuration

```bash
cp .env.example .env
```

### 3. Installer les dépendances et lancer le backend

```bash
cd backend
npm install
npm start
```

### 4. Vérifier que l'API répond

```bash
curl http://localhost:3001/health
# → { "status": "ok", "redis": "connected", ... }
```

## Tests et lint

```bash
cd backend
npm test        # tests unitaires — aucune connexion Redis requise
npm run lint    # vérification ESLint
```

## API

| Méthode | Route        | Body                                           | Description             |
|---------|--------------|------------------------------------------------|-------------------------|
| GET     | /health      | —                                              | État de l'app           |
| GET     | /tasks       | —                                              | Liste toutes les tâches |
| POST    | /tasks       | `{ title, description?, priority? }`           | Créer une tâche         |
| PUT     | /tasks/:id   | `{ title?, description?, status?, priority? }` | Modifier une tâche      |
| DELETE  | /tasks/:id   | —                                              | Supprimer une tâche     |

Valeurs `status` : `todo` · `in-progress` · `done`  
Valeurs `priority` : `low` · `medium` · `high`

## Variables d'environnement

| Variable      | Défaut                   | Description                   |
|---------------|--------------------------|-------------------------------|
| `PORT`        | `3001`                   | Port du backend               |
| `APP_ENV`     | `development`            | Environnement                 |
| `APP_VERSION` | `1.0.0`                  | Version affichée dans /health |
| `REDIS_URL`   | `redis://localhost:6379` | URL de connexion Redis        |

---

Ce projet est la base du projet final DevOps — Bachelor 3 Développement.  
Votre mission : le containeriser, automatiser sa livraison, et le déployer sur Kubernetes.
