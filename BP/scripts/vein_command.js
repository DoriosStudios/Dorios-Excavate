import { world, system, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus } from "@minecraft/server"
import { configMenu } from 'vein_menu.js'
import { veinHandler, shapeNames } from 'vein_mine.js'
import { list, blacklist, maxLimit, setMaxLimit } from 'global_variables.js'

function playerMessage(player, text) {
    system.run(() => {
        player.onScreenDisplay.setActionBar({ translate: text })
    })
}

const identifier = 'dorios:'

const permissionMap = {
    any: CommandPermissionLevel.Any,
    host: CommandPermissionLevel.Host,
    owner: CommandPermissionLevel.Owner,
    admin: CommandPermissionLevel.Admin,
    gamedirector: CommandPermissionLevel.GameDirectors,
}

const typeMap = {
    string: CustomCommandParamType.String,
    int: CustomCommandParamType.Integer,
    float: CustomCommandParamType.Float,
    bool: CustomCommandParamType.Boolean,
    enum: CustomCommandParamType.Enum,
    block: CustomCommandParamType.BlockType,
    item: CustomCommandParamType.ItemType,
    location: CustomCommandParamType.Location,
    target: CustomCommandParamType.EntitySelector,
    entityType: CustomCommandParamType.EntityType,
    player: CustomCommandParamType.PlayerSelector,
}


let shapeKeys = []
Object.keys(veinHandler).forEach(name => {
    shapeKeys.push(shapeNames[name])
})

const commands = [
    {
        name: "excavatedefaultadd",
        description: "Adds a block to the global default list. (Admin only)",
        permissionLevel: "admin",
        parameters: [
            {
                name: "block",
                type: "block"
            }
        ],
        callback(origin, block) {
            const player = origin.sourceEntity

            if (!player) return;

            if (blacklist.includes(block.id)) {
                playerMessage(player, '§cBlock is on the black list')
                return;
            }

            if (!list.includes(block.id)) {
                list.push(block.id)
                world.setDynamicProperty('dorios:initialVein', JSON.stringify(list))
                playerMessage(player, '§aBlock successfully added')
            } else {
                playerMessage(player, '§cBlock already added')
            }
        }
    },
    {
        name: "excavatedefaultremove",
        description: "Removes a block from the global default list. (Admin only)",
        permissionLevel: "admin",
        parameters: [
            {
                name: "block",
                type: "block"
            }
        ],
        callback(origin, block) {
            const player = origin.sourceEntity

            if (!player) return;

            if (list.includes(block.id)) {
                list = list.filter(id => id !== block.id)
                world.setDynamicProperty('dorios:initialVein', JSON.stringify(list))
                playerMessage(player, '§aBlock successfully removed')
            } else {
                playerMessage(player, '§cBlock is not on the list')
            }
        }
    },
    {
        name: "excavateblacklistadd",
        description: "Adds a block to the global blacklist. (Admin only)",
        permissionLevel: "admin",
        parameters: [
            {
                name: "block",
                type: "block"
            }
        ],
        callback(origin, block) {
            const player = origin.sourceEntity

            if (!player) return

            if (!blacklist.includes(block.id)) {
                blacklist.push(block.id)
                world.setDynamicProperty('dorios:veinBlacklist', JSON.stringify(blacklist))
                playerMessage(player, '§aBlock successfully added')
            } else {
                playerMessage(player, '§cBlock already added')
            }
        }
    },
    {
        name: "excavateblacklistremove",
        description: "Removes a block from the global blacklist. (Admin only)",
        permissionLevel: "admin",
        parameters: [
            {
                name: "block",
                type: "block"
            }
        ],
        callback(origin, block) {
            const player = origin.sourceEntity

            if (!player) return

            if (blacklist.includes(block.id)) {
                blacklist = blacklist.filter(id => id !== block.id)
                world.setDynamicProperty('dorios:veinBlacklist', JSON.stringify(blacklist))
                playerMessage(player, '§aBlock successfully removed')
            } else {
                playerMessage(player, '§cBlock is not on the list')
            }
        }
    },
    {
        name: "excavatemaxlimit",
        description: "Sets the global excavate block limit. (Admin only)",
        permissionLevel: "admin",
        parameters: [
            {
                name: "quantity",
                type: "int"
            }
        ],
        callback(origin, quantity) {
            const player = origin.sourceEntity

            if (!player) return

            setMaxLimit(quantity)
            world.setDynamicProperty('dorios:maxLimit', quantity)
            playerMessage(player, '§aData successfully updated')
        }
    },
    {
        name: "excavatemenu",
        description: "Opens your personal excavate configuration menu.",
        permissionLevel: "any",
        parameters: [],
        callback(origin) {
            const player = origin.sourceEntity

            if (!player) return;

            configMenu(player)

        }
    },
    {
        name: "excavateadd",
        description: "Adds a block to your personal excavate whitelist.",
        permissionLevel: "any",
        parameters: [
            {
                name: "block",
                type: "block"
            }
        ],
        callback(origin, block) {
            const player = origin.sourceEntity

            if (!player) return;

            if (blacklist.includes(block.id)) {
                playerMessage(player, '§cBlock is on the black list')
                return;
            }

            let veinList;
            try {
                const raw = player.getDynamicProperty("dorios:veinList");
                veinList = raw ? JSON.parse(raw) : list;
            } catch (e) {
                console.warn("[ERROR] Failed to read vein list, resetting...");
                veinList = list;
            }

            if (veinList.includes(block.id)) {
                playerMessage(player, '§cBlock already added')
            } else {
                veinList.push(block.id);
                player.setDynamicProperty("dorios:veinList", JSON.stringify(veinList));
                playerMessage(player, '§aBlock successfully added')
            }

        }
    },
    {
        name: "excavateremove",
        description: "Removes a block from your personal excavate whitelist.",
        permissionLevel: "any",
        parameters: [
            {
                name: "block",
                type: "block"
            }
        ],
        callback(origin, block) {
            const player = origin.sourceEntity

            if (!player) return;

            let veinList;
            try {
                const raw = player.getDynamicProperty("dorios:veinList");
                veinList = raw ? JSON.parse(raw) : list;
            } catch (e) {
                console.warn("[ERROR] Failed to read vein list, resetting...");
                veinList = list;
            }

            if (veinList.includes(block.id)) {
                veinList = veinList.filter(b =>
                    b != block.id
                )
                player.setDynamicProperty("dorios:veinList", JSON.stringify(veinList));
                playerMessage(player, '§aBlock successfully removed')
            } else {
                playerMessage(player, '§cBlock is not on the list')
            }

        }
    },
    {
        name: "excavatetoggle",
        description: "Toggles your excavate ability on or off.",
        permissionLevel: "any",
        parameters: [],
        callback(origin) {
            const player = origin.sourceEntity

            if (!player) return;

            let isEnabled = player.getDynamicProperty('dorios:veinEnabled')

            player.setDynamicProperty('dorios:veinEnabled', !isEnabled)

            if (isEnabled) {
                playerMessage(player, "§eExcavate §cDisabled")
            } else {
                playerMessage(player, "§eExcavate §aEnabled")
            }

        }
    },
    {
        name: "excavateshape",
        description: "Changes your current excavate shape or pattern.",
        permissionLevel: "any",
        parameters: [
            {
                name: "shape",
                type: "enum",
                enum: shapeKeys
            }
        ],
        callback(origin, shape) {
            const player = origin.sourceEntity

            if (!player) return;

            player.setDynamicProperty('dorios:veinShape', shape)
            playerMessage(player, "§aData successfully updated")

        }
    },
    {
        name: "excavatelimit",
        description: "Sets your personal block limit for excavate.",
        permissionLevel: "any",
        parameters: [
            {
                name: "quantity",
                type: "int"
            }
        ],
        callback(origin, quantity) {
            const player = origin.sourceEntity

            if (!player) return;

            if (maxLimit < quantity) {
                playerMessage(player, "§cMax Limit Exceded")
                return;
            }

            player.setDynamicProperty('dorios:veinLimit', quantity)
            playerMessage(player, "§aData successfully updated")
        }
    }
];

system.beforeEvents.startup.subscribe(e => {
    for (const cmd of commands) {
        const permission = permissionMap[cmd.permissionLevel?.toLowerCase()] ?? CommandPermissionLevel.Any;

        const definition = {
            name: identifier + `${cmd.name}`,
            description: cmd.description,
            permissionLevel: permission,
            cheatsRequired: cmd.cheatsRequired ?? false,
        };

        const mandatory = [], optional = [];

        if (Array.isArray(cmd.parameters)) {
            for (const param of cmd.parameters) {
                const paramDef = {
                    name: param.name,
                    type: typeMap[param.type] ?? CustomCommandParamType.String,
                };

                if (param.type === "enum" && Array.isArray(param.enum)) {
                    e.customCommandRegistry.registerEnum(identifier + `${param.name}`, param.enum)
                    mandatory.push({
                        name: identifier + `${param.name}`,
                        type: CustomCommandParamType.Enum
                    })
                    continue;
                }

                if (param.optional) {
                    optional.push(paramDef);
                } else {
                    mandatory.push(paramDef);
                }
            }
        }

        if (mandatory.length) definition.mandatoryParameters = mandatory;
        if (optional.length) definition.optionalParameters = optional;

        e.customCommandRegistry.registerCommand(definition, (origin, ...args) => {
            system.run(() => {
                cmd.callback(origin, ...args);
            })
        });
    }
});
