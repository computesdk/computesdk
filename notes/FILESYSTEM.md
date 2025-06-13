# Filesystem

The purpose of the file system service is to store, retrieve and manage filesystems that can be used by compute instances.

It will be backed by an S3 compatible storage system, and will provide a REST API for interacting with it.

* Fast initial load time
* Fast file access when on disk
* Individual file retrieval via API
* optimized storage (deduplication, compression, etc.)
* nice to have: versioning


Tigris is likely going to be our s3 object storage as it seems to be easier to work with than MinIO.

## System Architecture

The filesystem service will be designed with a focus on performance, efficient storage, and robust versioning. It will consist of a Central Go Service and a Devpod Agent.

### Core Components & Data Stores:

1.  **Central Go Service:** The backend service responsible for managing workspaces, versions, and orchestrating file operations.
2.  **Devpod Agent:** Runs within the compute instance (devpod), manages the local workspace representation, and communicates with the Central Go Service and S3.
3.  **S3 (Tigris):** The primary storage for all file content, using Content-Addressable Storage (CAS) for deduplication. All unique file blobs are stored here, named by their content hash.
4.  **Relational Database (RDBMS, e.g., PostgreSQL):** The central system of record for all filesystem metadata. This includes:
    *   Workspace definitions.
    *   Version history for each workspace (e.g., sequential versions, commit-like history).
    *   Authoritative mapping of `file_path -> cas_hash` for every file in every version of a workspace.
    *   Information about file sizes and potentially flags for "small files."

### `manifest.sqlite` - The Smart Archive:

To address the challenge of fast initial load times, especially with numerous small files (e.g., `node_modules`), a `manifest.sqlite` file will be used. This file acts as a portable, versioned "smart archive."

*   **Generation:** For each version of a workspace recorded in the RDBMS, the Central Go Service will generate a corresponding `manifest.sqlite` file.
*   **Content:**
    *   The full `file_path -> cas_hash` directory structure for that specific workspace version (data derived from the RDBMS).
    *   Embedded content (as BLOBs) for all files deemed "small." The threshold for "small" will be configurable (e.g., files < 128KB).
*   **Storage:** These versioned `manifest.sqlite` files will be stored persistently by the Central Go Service (e.g., in a dedicated S3 bucket).
*   **Benefit:** When a devpod requests a workspace version, it downloads this single `manifest.sqlite` file. It can then hydrate most of the workspace (especially small files like those in `node_modules`) directly from the local SQLite BLOBs, significantly reducing S3 GET requests and speeding up load times.

### Phased Implementation Plan:

Development will proceed in two main phases:

**Phase 1: MVP - Core Functionality**
*   **Central Service & Agent:** Implement core logic.
*   **Data Stores:** RDBMS and S3 (CAS) are fully implemented as systems of record.
*   **Manifest Delivery:** The Central Service sends a simple JSON manifest (`file_path -> cas_hash` list) to the Devpod Agent.
*   **Devpod Workspace Load:** The Agent fetches the JSON manifest, then retrieves *every file* individually from S3 using its CAS hash.
*   **Outcome:** Validates core CAS model, S3 integration, RDBMS structure, and basic versioning. Performance for workspaces with many small files will be suboptimal.

**Phase 2: Optimization - Introduce `manifest.sqlite`**
*   **Central Service:** Adds logic to generate, store, and serve versioned `manifest.sqlite` files (as described above).
*   **Devpod Agent:** Modifies workspace loading to fetch the `manifest.sqlite` file. It then reads small files from embedded BLOBs and only fetches designated "large" files from S3.
*   **Outcome:** Significant performance improvement for devpod startup/sync, especially for projects with `node_modules` or many small files.

### Versioning:

*   Versioning is a core concept, managed centrally in the RDBMS.
*   Each change to a workspace (e.g., file add/update/delete) results in a new version record in the RDBMS, with updated `file_path -> cas_hash` mappings.
*   In Phase 2, each RDBMS version will have a corresponding, immutable `manifest.sqlite` file, ensuring that devpods always get a consistent and version-specific view of the workspace.

This architecture aims to balance robustness, performance, and implementation complexity, allowing for iterative development while ensuring a strong foundation for future features.
