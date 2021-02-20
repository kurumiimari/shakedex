# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.5] - 2021-02-20
### Added

- Added automatic uploads to Shakedex Web, a web portal for shakedex swap proofs.

## [0.0.4] - 2021-02-20
### Added

- Added a method to write proof files to a stream in addition to a file.

## [0.0.3] - 2021-02-19
### Added

- Added an option to `Context` to support custom HSD hosts. 

## [0.0.2] - 2021-02-13
### Added

- Added a version identifier for swap proofs.
- Added a second version of the swap proof file that reduces the amount of duplicated data.

### Changed

- Changed the locking script to a shorter one. H/T @pinheadmz.
- Swapped out `cli-table` for `cli-table3`. H/T @MarkSchmidty.
- Various documentation tweaks.

### Fixed

- Fixed a `cannot read property 'height' of null` bug in `list-auctions`. H/T @pinheadmz.

## [0.0.1] - 2021-02-06
### Added

- Initial release.