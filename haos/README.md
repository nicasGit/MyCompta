# Add-on HAOS MyCompta

Ce dossier regroupe les fichiers destinés à Home Assistant OS :

```text
haos/
  prepare.js              Script de préparation du paquet
  repository.yaml         Informations du dépôt NJOSoftware
  mycompta/
    config.yaml           Configuration de l’add-on
    Dockerfile            Construction de l’image
    .dockerignore         Exclusions du contexte Docker
    addon.js              Chargement des options HAOS
    DOCS.md               Installation et configuration
    app/                  Code de l’application, généré automatiquement
```

## Préparer le paquet

Depuis la racine du projet MyCompta :

```powershell
npm run addon:prepare
```

Le script reconstruit [mycompta/app/](./mycompta/app/) avec les seuls fichiers nécessaires à l’exécution. Il exclut les secrets, les données, les PDF, les archives et `node_modules`. Ce dossier généré n’est pas versionné dans le dépôt de l’application. Relancer la commande après toute modification du code et avant de copier ou publier le paquet.

## Réutiliser le dépôt existant

[repository.yaml](./repository.yaml) reprend à l’identique le nom, l’URL et le mainteneur du [dépôt ComptaInf](https://github.com/nicasGit/comptainf-addon/blob/main/repository.yaml). Après préparation, copier **mycompta/** dans ce dépôt, à côté de son dossier **comptainf/**. Le fichier de dépôt déjà présent peut rester tel quel. Le code généré **mycompta/app/** doit être inclus lors de cette copie : Home Assistant construit l’image depuis le dossier de l’add-on et ne lit pas les sources de l’application situées ailleurs.

Pour un autre dépôt GitHub, adapter l’URL de `repository.yaml` à sa véritable adresse. Ce fichier doit être à la racine du dépôt d’add-ons publié ; les dossiers `mycompta/` et `comptainf/` y sont des dossiers voisins. Le dossier `haos/` du projet sert de paquet à exporter, pas d’URL de dépôt à ajouter directement dans Home Assistant.

Aucun contenu du dépôt distant n’est modifié ou publié par la préparation. Pour les options HAOS, OAuth, le proxy HTTPS et la reprise des données, voir le [guide de l’add-on](./mycompta/DOCS.md).
