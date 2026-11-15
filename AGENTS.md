# Publication des évolutions MyCompta

Consigne permanente de l'utilisateur : après chaque évolution terminée, vérifier
le résultat, créer les commits et pousser les changements sur GitHub, puis
incrémenter la version HAOS. Ces actions sont autorisées sans redemander une
confirmation à chaque fois.

- Publier le code applicatif dans `nicasGit/MyCompta` sur `main`.
- Incrémenter la version corrective dans `haos/mycompta/config.yaml` et dans
  `mycompta/config.yaml` du dépôt `nicasGit/comptainf-addon`.
- Mettre à jour `MYCOMPTA_COMMIT` dans les deux Dockerfiles avec le SHA complet
  du commit applicatif publié. Ne pas conserver une ancienne référence :
  changer uniquement la version YAML ne met pas le code embarqué à jour.
- Procéder en deux temps : commit/push du code, puis commit/push des métadonnées
  de publication qui référencent ce commit. Garder les deux dépôts cohérents.
- Limiter les modifications du dépôt d'add-ons au répertoire `mycompta`.
- Vérifier les diffs et les contrôles adaptés avant publication. Ne jamais
  inclure de secrets, de données du foyer ou de PDF privés dans les commits.
- Rapporter la version publiée et toute limite de validation. Ne pas prétendre
  avoir testé la construction Docker si elle n'a pas été exécutée.
- Cette autorisation ne demande pas d'installer ni de redémarrer automatiquement
  l'add-on sur le HAOS de l'utilisateur.
