#!/bin/bash

set -e

NEW_VERSION="$1"

if [ -z "$NEW_VERSION" ]; then
	echo "Usage: ./bump-version.sh <version>"
	echo "Example: ./bump-version.sh 1.0.1"
	exit 1
fi

if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
	echo "Error: Version must be in semver format (X.Y.Z)"
	exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# JSON files to update. dev/manifest.json only exists once someone has run a
# development build, and it is gitignored — so it is skipped rather than fatal.
JSON_FILES=(
	"package.json"
	"src/manifest.chrome.json"
	"src/manifest.firefox.json"
	"src/manifest.safari.json"
	"dev/manifest.json"
)

PBXPROJ="xcode/Tolaria Clipper/Tolaria Clipper.xcodeproj/project.pbxproj"

# The native host reports its own version in `doctor` and in every ping reply.
# It is a plain constant rather than a read of package.json, because the host
# is bundled and ships without one.
HOST_VERSION_FILE="src/native-host/doctor.ts"

echo "Bumping version to $NEW_VERSION"
echo ""

# Update JSON files
for file in "${JSON_FILES[@]}"; do
	filepath="$ROOT_DIR/$file"
	if [ ! -f "$filepath" ]; then
		echo "Skipped $file: not present"
		continue
	fi
	old_version=$(grep -o '"version": "[^"]*"' "$filepath" | head -1 | sed 's/"version": "//;s/"//')
	sed -i '' "s/\"version\": \"$old_version\"/\"version\": \"$NEW_VERSION\"/" "$filepath"
	echo "Updated $file: $old_version -> $NEW_VERSION"
done

# Update the native host's own version string
hostpath="$ROOT_DIR/$HOST_VERSION_FILE"
if [ -f "$hostpath" ]; then
	old_host=$(grep -o "HOST_VERSION = '[^']*'" "$hostpath" | head -1 | sed "s/HOST_VERSION = '//;s/'//")
	sed -i '' "s/HOST_VERSION = '$old_host'/HOST_VERSION = '$NEW_VERSION'/" "$hostpath"
	echo "Updated $HOST_VERSION_FILE: $old_host -> $NEW_VERSION"
else
	echo "Skipped $HOST_VERSION_FILE: not present"
fi

pbxpath="$ROOT_DIR/$PBXPROJ"
if [ -f "$pbxpath" ]; then
	# Update MARKETING_VERSION in Xcode project
	old_marketing=$(grep -o 'MARKETING_VERSION = [^;]*' "$pbxpath" | head -1 | sed 's/MARKETING_VERSION = //')
	sed -i '' "s/MARKETING_VERSION = $old_marketing;/MARKETING_VERSION = $NEW_VERSION;/g" "$pbxpath"
	# grep -c exits 1 on no match, which set -e would turn into a silent abort
	# halfway through the bump.
	marketing_count=$(grep -c "MARKETING_VERSION = $NEW_VERSION;" "$pbxpath" || true)
	echo "Updated project.pbxproj MARKETING_VERSION: $old_marketing -> $NEW_VERSION ($marketing_count occurrences)"

	# Increment CURRENT_PROJECT_VERSION
	old_build=$(grep -o 'CURRENT_PROJECT_VERSION = [0-9]*' "$pbxpath" | head -1 | sed 's/CURRENT_PROJECT_VERSION = //')
	new_build=$((old_build + 1))
	sed -i '' "s/CURRENT_PROJECT_VERSION = $old_build;/CURRENT_PROJECT_VERSION = $new_build;/g" "$pbxpath"
	build_count=$(grep -c "CURRENT_PROJECT_VERSION = $new_build;" "$pbxpath" || true)
	echo "Updated project.pbxproj CURRENT_PROJECT_VERSION: $old_build -> $new_build ($build_count occurrences)"
else
	echo "Skipped $PBXPROJ: not present"
fi

echo ""
echo "Done!"
