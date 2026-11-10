# MyCompta sur Home Assistant OS

Cet add-on exécute une seule instance de MyCompta pour tout le foyer, sur amd64 ou aarch64. L’interface utilise une URL HTTPS dédiée derrière votre proxy inverse ; l’Ingress Home Assistant n’est pas activé. Les fichiers financiers restent dans le Sheets et le Drive du propriétaire. Les membres accèdent aux documents par MyCompta, sans obtenir les jetons Google du propriétaire ni nécessiter un compte de service.

## Installation locale sur HAOS

1. Copier ce projet dans `/addons/mycompta/` sur HAOS, avec notamment `config.yaml`, `Dockerfile`, `addon.js`, les fichiers npm et les dossiers de l’application. Ne pas copier `.env`, `node_modules`, les archives ni les documents personnels.
2. Dans **Paramètres → Applications / Modules complémentaires → Boutique**, actualiser les applications locales puis installer **MyCompta**. Le nom des menus dépend de votre version de Home Assistant.
3. Configurer un proxy inverse HTTPS pointant vers le port HTTP interne **3001** de l’add-on. Utiliser un nom de domaine tel que `https://compta.votre-domaine.fr`, à la racine, sans sous-chemin. Conserver l’en-tête `Host` de cette URL. Le certificat doit être reconnu par les appareils des membres. Le port 3001 reste destiné au proxy ou au réseau privé ; ne pas l’exposer directement sur Internet.
4. Renseigner les options de l’add-on :

```yaml
app_url: https://compta.votre-domaine.fr
owner_email: proprietaire@gmail.com
google_client_id: votre-client.apps.googleusercontent.com
google_client_secret: votre-secret
```

5. Dans le client OAuth Google de type **Application Web**, ajouter exactement `https://compta.votre-domaine.fr/auth/callback` aux URI de redirection autorisées. Activer Google Drive API et Google Sheets API. Ajouter les adresses des membres aux utilisateurs de test si votre application Google est en mode test.
6. Démarrer l’add-on et ouvrir l’URL HTTPS dans un navigateur standard. Le bouton Web UI de HA redirige vers cette URL canonique. Se connecter d’abord avec `owner_email`, puis créer l’espace Google si nécessaire.
7. Dans **Mon foyer**, ajouter l’adresse Google de l’autre personne et lui transmettre l’URL. Aucun e-mail d’invitation n’est envoyé automatiquement. Elle peut ensuite se connecter depuis son propre appareil.

Les membres peuvent consulter et modifier les données, importer et relire les PDF et gérer les règles et budgets. Le propriétaire gère seul les membres, la création de l’espace et l’autorisation Google du stockage. Retirer un membre bloque ses prochaines requêtes, y compris depuis une session déjà ouverte ; les informations déjà consultées ou téléchargées ne peuvent pas être reprises.

## Reprendre l’espace actuel

Arrêter MyCompta sur l’ordinateur avant le transfert. Copier ses fichiers privés dans le dossier persistant `/data` **de cet add-on**, sans remplacer son `options.json` : `resources.json` permet de retrouver le même tableur et dossier Drive ; `token.json` conserve l’autorisation si le client OAuth reste le même. Reconnecter le propriétaire si nécessaire. Ne pas partager ces fichiers ni transférer les jetons vers le navigateur. Un ancien espace conserve l’identité Google de son propriétaire : changer `owner_email` ne transfère pas sa propriété.

Pour un nouveau client OAuth, copier `resources.json` ne suffit pas à donner accès aux anciens fichiers avec `drive.file`. Conserver le client OAuth utilisé pour créer l’espace, ou prévoir une migration des données vers un nouvel espace créé par le nouveau client. Ne pas supprimer les anciennes ressources avant vérification.

## Conservation et sauvegarde

Le dossier `/data` contient les options, les jetons du propriétaire, les identifiants Google, `household.json` (accès au foyer) et `sessions.json` (empreintes des sessions, durée de 30 jours). Les cookies sont HttpOnly, SameSite=Lax et Secure en HTTPS. Les membres utilisent des sessions distinctes ; leur connexion normale ne remplace pas l’autorisation Drive du propriétaire.

Sauvegarder cet add-on avec Home Assistant, en plus du tableur et des PDF. Les anciens documents et opérations reçoivent une colonne `createdBy` vide ; les nouveaux indiquent l’adresse du membre connecté. Une relecture conserve l’auteur des lignes retrouvées. Les écritures passent par une file unique sur cette instance ; ne pas exécuter deux instances simultanément sur le même tableur ni modifier ses lignes en parallèle d’une écriture de l’application.

Le déploiement et la construction de l’image nécessitent une validation sur votre HAOS. Le dépôt fournit les fichiers de construction ; aucune publication ni installation distante n’est effectuée automatiquement.

Références : [configuration des add-ons Home Assistant](https://developers.home-assistant.io/docs/apps/configuration/), [options des add-ons](https://contributors.home-assistant.io/apps/guides/options/), [OAuth Google côté serveur](https://developers.google.com/identity/protocols/oauth2/web-server).
