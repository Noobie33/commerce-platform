# Local storage and costs

## Where work happens

Staff upload through the Commerce interface. They do not need pgAdmin for product or photo work.

PostgreSQL stores catalog/staff/operational records and media metadata. pgAdmin is an administration client for PostgreSQL, not an image-hosting service. Actual media files live in the project's ignored protected local media directory, or an explicitly configured absolute MEDIA_STORAGE_DIR.

Photos are served through authenticated API routes. Original master, preview and thumbnail are distinct objects. Source code is stored in the existing private GitHub repository; database contents, credentials and media are excluded.

## Current charges and future budget

No new paid hosting, cloud-storage service, domain purchase or third-party subscription has been activated. The current application runs on the owner's Windows PC and uses its disk, processing resources, electricity and network.

PostgreSQL and pgAdmin permit use without a licence fee: [PostgreSQL licence](https://www.postgresql.org/about/licence/) and [pgAdmin licence](https://www.pgadmin.org/licence/). Existing AI subscription/usage charges, if any, are separate from the application's hosting/storage costs.

Internet deployment may require a domain, server/database hosting, media storage/delivery, backups and possibly transactional email/SMS. The cost depends on the selected services, traffic, storage and retention. No unverified monthly estimate or promise of permanently free production hosting is made.

Before activating a paid service, prepare a concrete option, pricing and recurring-cost scope for the owner's approval. Saving originals increases storage/backup use but does not itself create a cloud bill in this local setup.

## Operations

Backing up the Git repository does not back up business records or photos. Back up PostgreSQL and the media directory together, then verify a restore. The existing storage verifier is read-only and reports missing/corrupt/unreferenced objects without deleting them.
