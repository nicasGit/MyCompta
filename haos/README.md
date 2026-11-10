# Add-on HAOS MyCompta

Le code reste dans [MyCompta](https://github.com/nicasGit/MyCompta). Le dépôt [comptainf-addon](https://github.com/nicasGit/comptainf-addon) peut héberger les deux add-ons :

    comptainf-addon/
      repository.yaml
      comptainf/
      mycompta/
        config.yaml
        Dockerfile
        .dockerignore
        addon.js
        DOCS.md

## Publication et installation

Publier le petit dossier [mycompta/](./mycompta/) à la racine du dépôt d'add-ons, à côté de comptainf/. Aucun code applicatif ni dossier app/ n'est à copier. [repository.yaml](./repository.yaml) reprend les informations NJOSoftware du dépôt existant ; son fichier actuel peut rester inchangé.

Dans la boutique Home Assistant, ajouter **https://github.com/nicasGit/comptainf-addon**. Une adresse contenant /tree/main/haos désigne une page GitHub et ne peut pas être clonée. Si le dépôt est déjà ajouté, actualiser la boutique après publication de mycompta/.

## Sources et mises à jour

Le [Dockerfile](./mycompta/Dockerfile) consulte le dernier commit de main, récupère exactement ce commit et installe les dépendances. L'image finale contient uniquement les fichiers nécessaires à l'exécution. Le code doit donc être poussé dans le dépôt MyCompta avant la construction. HAOS doit pouvoir accéder à Internet et le dépôt doit être public.

Pour distribuer une mise à jour : pousser le code MyCompta, augmenter la version dans [config.yaml](./mycompta/config.yaml), puis publier cette modification dans le dépôt d'add-ons. Home Assistant proposera une mise à jour et construira une nouvelle image. Une reconstruction manuelle récupère aussi les dernières sources ; un simple redémarrage conserve l'image installée. Deux constructions de la même version peuvent utiliser des commits différents puisque main évolue.

Ces modifications locales ne publient rien sur GitHub. Voir [DOCS.md](./mycompta/DOCS.md) pour Google OAuth, le proxy HTTPS et la reprise des données.
