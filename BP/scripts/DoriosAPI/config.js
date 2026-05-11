
/**
 * DoriosAPI - Setup Instructions
 *
 * To ensure everything functions correctly, make sure to import the main API file
 * in your addon’s main script. The import should look like this:
 *
 * ```js
 * import './DoriosAPI/index.js';
 * ```
 *
 * Additionally, the **DoriosAPI** folder must be located in the `/scripts` directory
 * of your addon structure.
 *
 * Example folder structure:
 * ```
 * /scripts
 * └── /DoriosAPI
 *     └── index.js
 * ```
 */

/**
 * Addon Configuration
 *
 * This section contains the metadata for the addon, including its name,
 * author, version, identifier, and dependencies.
 * Dependencies can have additional properties:
 * - **name**: Optional. The custom name of the dependency to display in messages. If not provided, the `identifier` will be used.
 * - **warning**: Optional. A custom warning message to display if the dependency is missing or outdated.
 *
 * Example:
 * ```js
 * const addonData = {
 *     name: "UtilityCraft: Heavy Machinery",
 *     author: "Dorios Studios",
 *     identifier: "utilitycraft_heavy_machinery",
 *     version: "0.3.0",
 *     dependencies: {
 *         "utilitycraft": {
 *             version: "3.3.5",  // Required version
 *             name: "UtilityCraft",  // Custom name to display
 *             warning: "Please update to the latest version."  // Custom warning message
 *         }
 *     }
 * };
 * ```
 */
export const addonData = {
    name: "Dorios' Excavate",
    author: "Dorios Studios",
    identifier: "dorios_excavate",
    version: "1.2.0",
    optionalDependencies: {
        "uc_ascendant_technology": {
            name: "UtilityCraft: Ascendant Technology",
            version: "0.8.0",
            warning: "Update Ascendant Technology to keep Excavate bridge compatibility aligned with the latest custom drop handling."
        }
    }
}

/**
 * Module Imports
 *
 * To activate a module, uncomment the import line.
 * To deactivate a module, comment out the import line.
 *
 * Example of available modules:
 * - **blockClass.js**: Logic for block utilities and machines.
 * - **playerClass.js**: Helpers for player-related actions (inventory, stats).
 * - **itemStackClass.js**: Simplified methods for item stack manipulation.
 * - **entityClass.js**: Extended methods for handling entities and interactions.
 *
 * Example imports:
 * ```js
 * import './blockClass.js'; // Block utilities
 * // import './playerClass.js'; // Player helpers (disabled)
 * import './itemStackClass.js'; // Item stack handling
 * ```
 */
import './dependencyChecker.js'

import { world, system } from '@minecraft/server'
import { dependenciesRegistry, compareDependencyVersion } from './dependencyChecker.js'

const ascendantTechnologyID = 'uc_ascendant_technology'

export let isAscendantTechnologyPresent = false
export let ascendantTechnologyVersion = null

export function getDependencyData(identifier) {
    if (typeof identifier !== 'string' || identifier.length === 0) return null
    return dependenciesRegistry.get(identifier) ?? null
}

export function isDependencyPresent(identifier) {
    return Boolean(getDependencyData(identifier))
}

export function getOptionalDependencyConfig(identifier) {
    if (typeof identifier !== 'string' || identifier.length === 0) return null
    return addonData.optionalDependencies?.[identifier] ?? null
}

export function getOptionalDependencyData(identifier) {
    if (!getOptionalDependencyConfig(identifier)) return null
    return getDependencyData(identifier)
}

export function getOptionalDependencyVersionState(identifier) {
    const dependency = getOptionalDependencyData(identifier)
    const config = getOptionalDependencyConfig(identifier)
    const requiredVersion = config?.version
    const detectedVersion = dependency?.version

    if (!requiredVersion || !detectedVersion) return 'unknown'
    return compareDependencyVersion(requiredVersion, detectedVersion)
}

export function isOptionalDependencyPresent(identifier) {
    return Boolean(getOptionalDependencyData(identifier))
}

export function refreshAscendantTechnologyCompatibilityState() {
    const ascendantTechnology = getOptionalDependencyData(ascendantTechnologyID)
    isAscendantTechnologyPresent = Boolean(ascendantTechnology)
    ascendantTechnologyVersion = ascendantTechnology?.version ?? null
    return ascendantTechnology ?? null
}

function notifyOptionalDependencies() {
    const optionalDependencies = addonData.optionalDependencies ?? {}

    for (const [identifier, config] of Object.entries(optionalDependencies)) {
        const dependency = getOptionalDependencyData(identifier)
        if (!dependency) continue

        const detectedMessage = config?.detectedMessage
        if (detectedMessage) {
            world.sendMessage(detectedMessage)
        }

        const versionState = getOptionalDependencyVersionState(identifier)
        if (versionState !== 'outdated') continue

        const requiredVersion = config?.version ?? 'unknown'
        const detectedVersion = dependency.version ?? 'unknown'
        const dependencyName = config?.name ?? dependency.name ?? identifier
        world.sendMessage(`§eOptional dependency ${dependencyName} is outdated. Requires: §f${requiredVersion}§e, found: §f${detectedVersion}§e.`)
        if (config?.warning) {
            world.sendMessage(`§7${config.warning}§r`)
        }
    }
}

world.afterEvents.worldLoad.subscribe(() => {
    system.runTimeout(() => {
        refreshAscendantTechnologyCompatibilityState()
        notifyOptionalDependencies()
    }, 340)
})