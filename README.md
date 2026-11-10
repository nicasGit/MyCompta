# MyCompta

Application en français pour suivre les dépenses d’un foyer, en mode local personnel ou en add-on HAOS partagé. Les données financières sont stockées dans Google Sheets, les PDF dans Google Drive. Node.js 24 est recommandé.

## Add-on HAOS et foyer partagé

Les fichiers [config.yaml](./config.yaml), [Dockerfile](./Dockerfile) et [addon.js](./addon.js) préparent une installation locale sur HAOS. Suivre le [guide de déploiement](./DOCS.md) pour l’URL HTTPS, les options, le proxy inverse, OAuth et le transfert de l’espace existant. Docker n’étant pas disponible dans l’environnement de développement, la construction et l’installation HAOS restent à confirmer sur la machine cible.

Le mode partagé s’active avec `MULTI_USER=true`, `APP_URL`, `OWNER_EMAIL` et un `DATA_DIR` persistant. Chaque personne utilise sa propre session Google. Le propriétaire ajoute et retire les adresses autorisées dans **Mon foyer** ; les membres accèdent aux mêmes données et peuvent en ajouter ou en modifier. Leur connexion normale demande uniquement l’identité Google et ne remplace pas les jetons Drive/Sheets du propriétaire. Les PDF sont servis par une route authentifiée de MyCompta ; il n’est pas nécessaire de partager le jeton propriétaire ni d’élargir le scope `drive.file` des membres.

Les nouvelles opérations et documents portent `createdBy` (adresse du compte connecté). Les anciens champs financiers restent en place : `createdBy` est ajouté en P des opérations et I des documents si ces emplacements sont libres. Les sessions persistantes stockent une empreinte du cookie, jamais sa valeur brute ; le retrait d’un membre invalide son accès côté serveur. Aucun e-mail d’invitation n’est envoyé automatiquement.

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

Les scopes `openid email profile` permettent d’afficher le nom et l’adresse vérifiée du compte connecté, selon [Google OpenID Connect](https://developers.google.com/identity/openid-connect/reference). Le scope `drive.file` limite l’accès aux fichiers créés ou autorisés pour l’application, y compris son tableur. Les API sont appelées depuis le serveur ; le secret et les jetons ne sont jamais envoyés à l’interface. Voir les documentations officielles [OAuth côté serveur](https://developers.google.com/identity/protocols/oauth2/web-server), [autorisations Sheets](https://developers.google.com/workspace/sheets/api/scopes) et [import Drive](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

La connexion reprend le parcours de ComptaInf (sélection du compte, connexion conservée, identité visible), sans compte de service. Utiliser un client OAuth dédié à MyCompta : les jetons et identifiants de ComptaInf ne sont pas copiés. L’espace reste lié à l’identifiant Google stable du propriétaire ; en mode partagé, les membres autorisés y accèdent via l’application sans devenir propriétaires du stockage. Pour une ancienne connexion sans identité, se déconnecter puis se reconnecter afin d’autoriser les nouveaux scopes.

Le dossier **MyCompta · Documents** contient les PDF et le tableur **MyCompta · Foyer**. Ses onglets sont `Documents`, `Operations`, `Comptes`, `Categories`, `Budgets` et `Fournisseurs`. Les en-têtes techniques doivent être conservés. Les cellules sont écrites comme valeurs brutes, jamais comme formules issues des libellés importés.

## Parcours de la V1

- Importer un PDF texte de 15 Mo maximum, en choisissant sa source. Il est archivé dans Drive, avec détection des doublons par empreinte SHA-256.
- Les relevés Cembra sont nommés automatiquement **Cembra - AAAA-MM-JJ.pdf** à partir d’une date explicitement libellée « Date de facture », « Date de facturation », « Facture du » ou « Relevé du ». Les dates numériques et les mois français en toutes lettres sont acceptés. Si la date manque ou si plusieurs dates différentes sont trouvées, le nom actuel est conservé ; aucune date de transaction, d’échéance ou d’import n’est utilisée à sa place.
- Pour un relevé Cembra déjà importé, **Renommer avec la date de facture** dans la bibliothèque met à jour le nom dans Drive et Sheets sans modifier les opérations. La relecture Cembra applique également ce nom. Le document et le fichier conservent leurs identifiants et leurs liens ; deux relevés différents peuvent avoir le même nom dans Drive sans se remplacer. Comme pour l’import, Drive et Sheets ne constituent pas une transaction unique : une erreur après le renommage Drive peut nécessiter de relancer l’action pour synchroniser le nom dans Sheets.
- **Cembra** utilise un parseur dédié au tableau « Date de trans. / Date de com. / Description / Crédit CHF / Débit CHF » sur toutes les pages. Il conserve les cellules vides pour distinguer les débits des crédits, écarte les soldes et récapitulatifs et refuse les lignes ambiguës. La date de transaction sert de date de l’opération ; la date de comptabilisation reste dans la ligne d’origine. Les débits deviennent des dépenses, les crédits des revenus/remboursements, et les libellés explicites de paiement reçu deviennent des règlements de carte. Ce format est testé sur des PDF synthétiques avec tableaux tracés ; un relevé réel reste nécessaire pour confirmer la compatibilité.
- Pour les autres sources, les lignes simples « date complète, libellé, montant, devise facultative » deviennent des opérations directement incluses avec l’extracteur générique.
- Pour Cembra, l’en-tête placé avant chaque tableau (« Carte principale/supplémentaire … se termine par … ») fournit le titulaire, les quatre derniers chiffres et le type de carte. Ces informations sont associées aux opérations du tableau, y compris si plusieurs cartes figurent sur la même page. Le titulaire et la fin de carte sont visibles, recherchables et modifiables dans les opérations. Une identité non reconnue reste vide pour correction manuelle ; il s’agit du titulaire de la carte, pas d’une preuve de l’identité de l’acheteur.
- Les colonnes `holder`, `cardLast4` et `cardType` sont ajoutées en M à O de l’onglet `Operations`. Les anciens tableurs sont mis à jour à leur lecture, uniquement si ces colonnes sont libres, sans modifier les données A à L. Les opérations déjà importées restent sans titulaire jusqu’à leur correction manuelle ou à une relecture Cembra autorisée.
- Dans la bibliothèque, **Relire le détail Cembra** récupère le PDF déjà archivé et remplace les opérations du document dans une seule requête Sheets, même après modification ou exclusion. Les correspondances sont recherchées par date, libellé, montant, devise et fin de carte, avec reprise des anciennes lignes sans fin de carte ; les achats identiques sont associés un par un. Les identifiants, catégories, comptes, types et exclusions des lignes retrouvées sont conservés. Les lignes sans correspondance sont remplacées ; une modification manuelle de date, libellé ou montant peut donc être perdue. La confirmation le rappelle avant relecture. Si aucun détail n’est reconnu, les opérations existantes sont conservées. Le PDF n’est pas téléversé à nouveau.
- Les opérations sont incluses automatiquement. **À catégoriser** regroupe celles dont la catégorie reste à compléter, sans bloquer leur présence dans les listes, les budgets ou les totaux. Les anciennes lignes `pending` sont également incluses ; `validated` reste le statut technique des nouvelles lignes, `ignored` les exclut. Une opération reste modifiable ou peut être ignorée à tout moment, sans étape de validation obligatoire.
- Les montants sont positifs ; le type distingue dépense, revenu/remboursement, virement et règlement de carte. Toutes les dépenses non ignorées entrent dans les analyses, même sans catégorie. Les remboursements ne sont pas soustraits automatiquement.
- **Fournisseurs** permet d’ajouter, modifier, rechercher et supprimer les associations fournisseur/catégorie. L’onglet Sheets `Fournisseurs` contient `id`, `name`, `category` ; il est créé automatiquement pour les anciens espaces. Les règles initiales sont Coop, Migros, Aldi, Lidl → Alimentation et CFF → Transports. Elles ne sont ajoutées qu’à la création de l’onglet et ne réapparaissent pas après suppression.
- La catégorisation s’applique aux dépenses et revenus/remboursements encore « À catégoriser » lors des imports, de la saisie d’une nouvelle opération et des relectures. Les règles reconnaissent des mots ou expressions du libellé, sans casse ni accents et avec normalisation de la ponctuation ; « Coop » correspond à « Coop-5145 Savigny », mais pas à « Coopérative ». La règle correspondante la plus longue prime : « Coop Pronto » peut préciser la règle « Coop ». Les catégories renseignées, virements, règlements de carte et opérations ignorées sont conservés.
- **Classer les opérations sans catégorie** applique les règles à tous les mois, uniquement aux opérations encore sans catégorie, et écrit seulement leurs cellules de catégorie dans une requête Sheets groupée. Une modification ou suppression de règle ne reclasse pas automatiquement les opérations déjà catégorisées ; leur catégorie reste modifiable individuellement.
- Afficher les dépenses par mois et catégorie, séparées par devise, et définir des budgets mensuels en CHF.
- Ajouter manuellement des opérations, avec ou sans document. Une importation sans ligne reconnue reste disponible dans la bibliothèque pour la saisie manuelle.

## Limites et conservation

L’extraction peut être corrigée depuis les opérations. Les PDF scannés sont archivés mais nécessitent une saisie manuelle : pas d’OCR. Les relevés protégés ou illisibles sont refusés. Pas de récupération automatique auprès des banques, de conversion de devises, ni de gestion des comptes depuis l’interface dans cette version. Les catégories proposées restent celles de la liste actuelle ; la vue Fournisseurs permet de modifier les associations, pas de créer de nouvelles catégories.

Par défaut, le serveur écoute uniquement sur la boucle locale et fonctionne sur un ordinateur de confiance. Une écoute réseau nécessite le mode partagé, les sessions et une URL HTTPS derrière un proxy inverse (voir le guide HAOS). Les écritures sont séquencées sur une seule instance : ne pas lancer deux serveurs sur le même tableur ni modifier ses lignes en parallèle d’une écriture de l’application. Document et candidats sont enregistrés dans une seule requête Sheets atomique. Drive et Sheets ne forment pas une transaction unique : en cas d’échec partiel, le PDF peut déjà être dans Drive. Une nouvelle importation du même fichier le réutilise.

[data/](./data/), ou `DATA_DIR`, contient les jetons OAuth, les identifiants Drive/Sheets, les accès au foyer et les empreintes des sessions. Ce dossier et [.env](./.env) sont ignorés par Git et doivent rester privés. En mode partagé, « Me déconnecter » ferme uniquement la session courante ; le propriétaire peut séparément retirer l’autorisation Google du stockage pour tout le foyer. Le tableur, les PDF et leurs identifiants sont conservés. En mode de consentement externe « Test », Google peut imposer une reconnexion périodique.

## Vérifier

```powershell
npm test
```

Les tests utilisent de faux appels Google et des PDF synthétiques, sans accès au compte ni aux documents personnels. La connexion et l’import sur un véritable compte Google nécessitent les identifiants de l’utilisateur et restent à valider après configuration.
