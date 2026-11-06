# MyCompta

Application locale en français pour suivre les dépenses d’un foyer. Les données financières sont stockées dans Google Sheets, les PDF dans Google Drive. Node.js 24 est recommandé.

## Démarrer

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Ouvrir http://localhost:3001. Sans identifiants Google, le mode « Explorer un exemple » permet de parcourir une interface avec des données fictives, en lecture seule.

## Configurer Google

1. Créer un projet dans [Google Cloud Console](https://console.cloud.google.com/).
2. Activer **Google Drive API** et **Google Sheets API**.
3. Configurer Google Auth Platform : audience externe en mode test pour un compte personnel, et ajouter son adresse comme utilisateur de test.
4. Créer un client OAuth **Application Web** avec cette URI de redirection exacte : `http://localhost:3001/auth/callback`.
5. Renseigner `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` dans [.env](./.env), à partir du modèle [.env.example](./.env.example), puis redémarrer.
6. Dans « Mon espace Google », cliquer sur **Connecter Google**, puis **Créer / vérifier mon espace**. Si Google refuse la connexion, contrôler le compte de test, les API activées et l’URI exacte.

Seul le scope `drive.file` est demandé : il permet de gérer les fichiers créés ou autorisés pour l’application, y compris son tableur. Les API sont appelées depuis le serveur ; le secret et les jetons ne sont jamais envoyés à l’interface. Voir les documentations officielles [OAuth côté serveur](https://developers.google.com/identity/protocols/oauth2/web-server), [autorisations Sheets](https://developers.google.com/workspace/sheets/api/scopes) et [import Drive](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

Le dossier **MyCompta · Documents** contient les PDF et le tableur **MyCompta · Foyer**. Ses onglets sont `Documents`, `Operations`, `Comptes`, `Categories` et `Budgets`. Les en-têtes techniques doivent être conservés. Les cellules sont écrites comme valeurs brutes, jamais comme formules issues des libellés importés.

## Parcours de la V1

- Importer un PDF texte de 15 Mo maximum, en choisissant sa source. Il est archivé dans Drive, avec détection des doublons par empreinte SHA-256.
- Les lignes simples « date complète, libellé, montant, devise facultative » deviennent des candidats **à vérifier**. Toutes les sources utilisent actuellement le même extracteur générique. Aucun format bancaire n’est encore certifié ; les fichiers de parseurs existants sont réservés à leur adaptation à des relevés réels.
- Ouvrir chaque ligne, consulter le PDF d’origine, corriger la date, le montant, la devise, le compte, la catégorie et le type, puis la valider ou l’ignorer. Un signalement indique un éventuel doublon de date, montant, devise et libellé.
- Les montants sont positifs ; le type distingue dépense, revenu/remboursement, virement et règlement de carte. Seules les dépenses validées entrent dans les analyses. Les remboursements ne sont pas soustraits automatiquement.
- Afficher les dépenses par mois et catégorie, séparées par devise, et définir des budgets mensuels en CHF.
- Ajouter manuellement des opérations, avec ou sans document. Une importation sans ligne reconnue reste disponible dans la bibliothèque pour la saisie manuelle.

## Limites et conservation

L’extraction ne remplace pas la vérification du relevé. Les PDF scannés sont archivés mais nécessitent une saisie manuelle : pas d’OCR. Les relevés protégés ou illisibles sont refusés. Pas de récupération automatique auprès des banques, de conversion de devises, de règles automatiques de catégorisation, ni de gestion des comptes depuis l’interface dans cette version.

Le serveur écoute uniquement sur la boucle locale. Cette version est destinée à une personne sur un ordinateur de confiance, pas à un hébergement public ou à plusieurs utilisateurs. Ne pas modifier le tableur en parallèle d’une écriture dans l’application. Les écritures de l’application sont séquencées ; document et candidats sont enregistrés dans une seule requête Sheets atomique. Drive et Sheets ne forment pas une transaction unique : en cas d’échec partiel, le PDF peut déjà être dans Drive. Une nouvelle importation du même fichier le réutilise.

[data/](./data/) contient uniquement les jetons OAuth et les identifiants Drive/Sheets. Ce dossier et [.env](./.env) sont ignorés par Git et doivent rester privés. La déconnexion révoque le jeton Google et efface sa copie locale ; le tableur, les PDF et leurs identifiants sont conservés. Se reconnecter avec le même compte. En mode de consentement externe « Test », Google peut imposer une reconnexion périodique.

## Vérifier

```powershell
npm test
```

Les tests utilisent de faux appels Google et des PDF synthétiques, sans accès au compte ni aux documents personnels. La connexion et l’import sur un véritable compte Google nécessitent les identifiants de l’utilisateur et restent à valider après configuration.
