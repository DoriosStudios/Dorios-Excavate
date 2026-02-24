import { world, system, ItemStack } from '@minecraft/server'
import { ActionFormData, ModalFormData } from '@minecraft/server-ui'
import { veinHandler, shapeNames } from 'vein_mine.js'
import { list, blacklist, maxLimit, setMaxLimit } from 'global_variables.js'

function playerMessage(player, text) {
    system.run(() => {
        player.onScreenDisplay.setActionBar({ translate: text })
    })
}

function clampNumber(value, min, max, integer = false) {
    if (!Number.isFinite(value)) return null

    const parsed = integer ? Math.floor(value) : value
    return Math.min(Math.max(parsed, min), max)
}

function getWorldBoolean(propertyId, fallback = false) {
    const value = world.getDynamicProperty(propertyId)
    return typeof value === 'boolean' ? value : fallback
}

function getWorldNumber(propertyId, fallback, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, integer = false) {
    const raw = Number(world.getDynamicProperty(propertyId))
    const source = Number.isFinite(raw) ? raw : fallback
    return clampNumber(source, min, max, integer)
}

function getPlayerVeinConnect(player) {
    let value = player.getDynamicProperty('dorios:veinConnect')

    if (value === undefined) {
        value = getWorldBoolean('dorios:veinConnectDefault', false)
        player.setDynamicProperty('dorios:veinConnect', value)
    }

    return !!value
}

system.beforeEvents.startup.subscribe(e => {
    e.itemComponentRegistry.registerCustomComponent('dorios:excavate_settings', {
        onUse(e) {
            configMenu(e.source)
        }
    })
})

world.afterEvents.playerSpawn.subscribe(e => {
    const { initialSpawn, player } = e
    if (!initialSpawn) return
    if (player.hasTag("dorios:spawned")) return
    player.addTag("dorios:spawned")
    player.getComponent('inventory').container.addItem(new ItemStack("dorios:settings_item"))
})
// Mapa de nombres bonitos para las shapes

export function configMenu(player) {
    const veinShape = player.getDynamicProperty("dorios:veinShape") ?? "Default";
    const playerLimit = player.getDynamicProperty("dorios:veinLimit") ?? 64;
    const globalLimit = getWorldNumber("dorios:maxLimit", maxLimit, 1, 4096, true);
    const currentVeinConnect = getPlayerVeinConnect(player);

    const menu = new ActionFormData()
        .title('Excavate Configuration')
        .button('Add Block', "textures/ui/realms_slot_check")
        .button('Remove Block', "textures/ui/realms_red_x")
        .button(`Shape Mode\n§8Current: §e${shapeNames[veinShape]}`, "textures/ui/world_glyph")
        .button(`Block Limit\n§8Personal: §e${playerLimit} §8/ Global: §b${globalLimit}`, "textures/ui/icon_setting");

    const enabled = player.getDynamicProperty('dorios:veinEnabled');
    const toggleLabel = enabled ? "Disable Excavate\n§a[ON]" : "Enable Excavate\n§c[OFF]";
    const toggleIcon = enabled ? "textures/ui/toggle_on" : "textures/ui/toggle_off";
    menu.button(toggleLabel, toggleIcon);

    const connectLabel = currentVeinConnect ? "Vein Connect\n§a[ON]" : "Vein Connect\n§c[OFF]";
    const connectIcon = currentVeinConnect ? "textures/ui/online" : "textures/ui/Ping_Offline_Red_Dark";
    menu.button(connectLabel, connectIcon);

    const baseButtons = 6;

    if (player.playerPermissionLevel == 2) {
        menu.button('Admin Settings', "textures/ui/icon_setting");
    }

    menu.show(player).then(({ canceled, selection }) => {
        if (canceled) return;

        switch (selection) {
            case 0:
                playerMessage(player, '§eBreak a block to add it ');
                player.setDynamicProperty('dorios:isAdding', !player.getDynamicProperty("dorios:isAdding"));
                break;

            case 1:
                let veinList;
                try {
                    const raw = player.getDynamicProperty("dorios:veinList");
                    veinList = raw ? JSON.parse(raw) : list;
                } catch (e) {
                    console.warn("[ERROR] Failed to read vein list, resetting...");
                    veinList = list;
                }

                let removeMenu = new ActionFormData().title('Select a block to remove');
                veinList.forEach(block => removeMenu.button({ translate: (new ItemStack(block).localizationKey) }));

                removeMenu.show(player).then(({ canceled, selection }) => {
                    if (canceled) return;
                    const selectedBlock = veinList[selection];
                    if (selectedBlock) {
                        veinList.splice(selection, 1);
                        player.setDynamicProperty("dorios:veinList", JSON.stringify(veinList));
                        playerMessage(player, '§aBlock successfully removed');
                    }
                });
                break;

            case 2:
                let shapes = new ActionFormData().title('Vein Shapes');
                Object.keys(veinHandler).forEach(name => shapes.button(`${shapeNames[name]}`));

                shapes.show(player).then(({ canceled, selection }) => {
                    if (canceled) return;
                    const shape = Object.keys(veinHandler)[selection];
                    player.setDynamicProperty('dorios:veinShape', shape);
                    playerMessage(player, "§aData successfully updated");
                    configMenu(player); // refresca menú
                });
                break;

            case 3:
                const currentLimit = player.getDynamicProperty("dorios:veinLimit") ?? 64;
                new ModalFormData()
                    .title('Vein Limit')
                    .label(`Current: ${currentLimit}`)
                    .slider('Limit', 1, globalLimit, { defaultValue: Math.min(currentLimit, globalLimit) })
                    .show(player).then(({ canceled, formValues }) => {
                        if (canceled) return;
                        const quantity = Math.floor(formValues[1]);
                        player.setDynamicProperty('dorios:veinLimit', quantity);
                        playerMessage(player, `§aLimit set to §e${quantity}`);
                        configMenu(player); // refresca menú
                    });
                break;

            case 4:
                const isEnabled = player.getDynamicProperty('dorios:veinEnabled');
                player.setDynamicProperty('dorios:veinEnabled', !isEnabled);
                playerMessage(player, isEnabled ? "§eExcavate §cDisabled" : "§eExcavate §aEnabled");
                configMenu(player); // refresca
                break;

            case 5: {
                const currentConnect = getPlayerVeinConnect(player);
                const nextConnect = !currentConnect;
                player.setDynamicProperty('dorios:veinConnect', nextConnect);
                playerMessage(player, `§eVein Connect: ${nextConnect ? "§aEnabled" : "§cDisabled"}`);
                configMenu(player);
                break;
            }

            case baseButtons:
                adminMenu(player);
                break;
        }
    });
}

// =============================
// Menú de administrador
// =============================
function adminMenu(player) {
    // === Valores actuales (inversos) ===
    const noConsumeDurability = world.getDynamicProperty("dorios:noConsumeDurability") ?? false;
    const noConsumeSaturation = world.getDynamicProperty("dorios:noConsumeSaturation") ?? false;
    const globalLimit = getWorldNumber("dorios:maxLimit", maxLimit, 1, 4096, true);
    const defaultVeinConnect = getWorldBoolean("dorios:veinConnectDefault", false);
    const durabilityCost = getWorldNumber("dorios:durabilityCost", 1, 0, 32, true);
    const durabilityChance = getWorldNumber("dorios:durabilityChance", 1, 0, 1, false);
    const consumeInterval = getWorldNumber("dorios:consumeInterval", 10, 1, 1024, true);
    const hungerCost = getWorldNumber("dorios:hungerCost", 1, 0, 20, true);
    const saturationCost = getWorldNumber("dorios:saturationCost", 1, 0, 20, true);
    const breakDelayEvery = getWorldNumber("dorios:breakDelayEvery", 32, 1, 1024, true);
    const breakDelayTicks = getWorldNumber("dorios:breakDelayTicks", 1, 0, 20, true);

    // === Construcción del menú ===
    const adminMenuForm = new ActionFormData()
        .title('Admin Settings')
        .button(`Set Global Block Limit\n§8Current: §e${globalLimit}`, "textures/ui/Wrenches1")
        .button('Add to Blacklist', "textures/blocks/barrier")
        .button('Remove from Blacklist', "textures/ui/icon_trash")
        .button('Add to Default List', "textures/ui/realms_slot_check")
        .button('Remove from Default List', "textures/ui/realms_red_x")
        .button(`Consume Durability\n${!noConsumeDurability ? "§a[ON]" : "§c[OFF]"}`, "textures/ui/anvil_icon")
        .button(`Consume Saturation\n${!noConsumeSaturation ? "§a[ON]" : "§c[OFF]"}`, "textures/ui/hunger_full")
        .button(`Default Vein Connect\n${defaultVeinConnect ? "§a[ON]" : "§c[OFF]"}`, "textures/ui/multiplayer_glyph_color")
        .button(
            `Advanced Mining Settings\n§8Durability: §e${durabilityCost} @ ${(durabilityChance * 100).toFixed(0)}%\n§8Food: §e${hungerCost}/${saturationCost} §8every §e${consumeInterval}\n§8Delay: §e${breakDelayTicks}t §8every §e${breakDelayEvery}`,
            "textures/ui/gear"
        )
        .button('§8Back', "textures/ui/arrow_left");

    // === Mostrar el formulario ===
    adminMenuForm.show(player).then(({ canceled, selection }) => {
        if (canceled) return;

        switch (selection) {
            // ===== Global Limit =====
            case 0:
                new ModalFormData()
                    .title('Set Global Limit')
                    .label(`Current: ${globalLimit}`)
                    .textField('New Limit', `${globalLimit}`)
                    .show(player).then(({ canceled, formValues }) => {
                        if (canceled) return;

                        const quantity = clampNumber(Number(formValues[1]), 1, 4096, true);
                        if (quantity === null) {
                            playerMessage(player, '§cNumber not valid');
                            return;
                        }

                        setMaxLimit(quantity);
                        world.setDynamicProperty('dorios:maxLimit', quantity);
                        world.setDynamicProperty('dorios:maxVeinLimit', quantity);
                        playerMessage(player, `§aGlobal Limit set to §e${quantity}`);
                        adminMenu(player); // refrescar
                    });
                break;

            // ===== Blacklist add =====
            case 1:
                playerMessage(player, '§eBreak a block to add it ');
                player.setDynamicProperty('dorios:isBlacklistAdding', !player.getDynamicProperty("dorios:isBlacklistAdding"));
                break;

            // ===== Blacklist remove =====
            case 2:
                const blackListMenu = new ActionFormData().title('Select a block to remove');
                blacklist.forEach(block => blackListMenu.button({ translate: (new ItemStack(block).localizationKey) }));

                blackListMenu.show(player).then(({ canceled, selection }) => {
                    if (canceled) return;
                    const selectedBlock = blacklist[selection];
                    if (selectedBlock) {
                        blacklist.splice(selection, 1);
                        world.setDynamicProperty('dorios:veinBlacklist', JSON.stringify(blacklist));
                        playerMessage(player, '§aBlock successfully removed');
                    }
                });
                break;

            // ===== Default add =====
            case 3:
                playerMessage(player, '§eBreak a block to add it ');
                player.setDynamicProperty('dorios:isDefaultAdding', !player.getDynamicProperty("dorios:isDefaultAdding"));
                break;

            // ===== Default remove =====
            case 4:
                const defaultMenu = new ActionFormData().title('Select a block to remove');
                list.forEach(block => defaultMenu.button({ translate: (new ItemStack(block).localizationKey) }));

                defaultMenu.show(player).then(({ canceled, selection }) => {
                    if (canceled) return;
                    const selectedBlock = list[selection];
                    if (selectedBlock) {
                        list.splice(selection, 1);
                        world.setDynamicProperty('dorios:initialVein', JSON.stringify(list));
                        playerMessage(player, '§aBlock successfully removed');
                    }
                });
                break;

            // ===== Consume Durability =====
            case 5: {
                const current = world.getDynamicProperty("dorios:noConsumeDurability") ?? false;
                const newState = !current;
                world.setDynamicProperty("dorios:noConsumeDurability", newState);
                playerMessage(player, `§eConsume Durability: ${!newState ? "§aEnabled" : "§cDisabled"}`);
                adminMenu(player); // refresca para mostrar estado actualizado
                break;
            }

            // ===== Consume Saturation =====
            case 6: {
                const current = world.getDynamicProperty("dorios:noConsumeSaturation") ?? false;
                const newState = !current;
                world.setDynamicProperty("dorios:noConsumeSaturation", newState);
                playerMessage(player, `§eConsume Saturation: ${!newState ? "§aEnabled" : "§cDisabled"}`);
                adminMenu(player); // refresca
                break;
            }

            // ===== Default Vein Connect =====
            case 7:
                world.setDynamicProperty("dorios:veinConnectDefault", !defaultVeinConnect);
                playerMessage(player, `§eDefault Vein Connect: ${!defaultVeinConnect ? "§aEnabled" : "§cDisabled"}`);
                adminMenu(player);
                break;

            // ===== Advanced Mining Settings =====
            case 8:
                new ModalFormData()
                    .title('Advanced Mining Settings')
                    .label('Use numeric values only. Default profile keeps current addon behavior.')
                    .textField('Durability Cost Per Block (0-32)', `${durabilityCost}`)
                    .textField('Durability Chance (0.0 - 1.0)', `${durabilityChance}`)
                    .textField('Food Consume Interval in Blocks (1-1024)', `${consumeInterval}`)
                    .textField('Hunger Cost (0-20)', `${hungerCost}`)
                    .textField('Saturation Cost (0-20)', `${saturationCost}`)
                    .textField('Break Delay Every N Blocks (1-1024)', `${breakDelayEvery}`)
                    .textField('Break Delay Ticks (0-20)', `${breakDelayTicks}`)
                    .show(player).then(({ canceled, formValues }) => {
                        if (canceled) return;

                        const nextDurabilityCost = clampNumber(Number(formValues[1]), 0, 32, true);
                        const nextDurabilityChance = clampNumber(Number(formValues[2]), 0, 1, false);
                        const nextConsumeInterval = clampNumber(Number(formValues[3]), 1, 1024, true);
                        const nextHungerCost = clampNumber(Number(formValues[4]), 0, 20, true);
                        const nextSaturationCost = clampNumber(Number(formValues[5]), 0, 20, true);
                        const nextBreakDelayEvery = clampNumber(Number(formValues[6]), 1, 1024, true);
                        const nextBreakDelayTicks = clampNumber(Number(formValues[7]), 0, 20, true);

                        if (
                            nextDurabilityCost === null ||
                            nextDurabilityChance === null ||
                            nextConsumeInterval === null ||
                            nextHungerCost === null ||
                            nextSaturationCost === null ||
                            nextBreakDelayEvery === null ||
                            nextBreakDelayTicks === null
                        ) {
                            playerMessage(player, '§cInvalid values detected. Use numbers only.');
                            return;
                        }

                        world.setDynamicProperty('dorios:durabilityCost', nextDurabilityCost);
                        world.setDynamicProperty('dorios:durabilityChance', nextDurabilityChance);
                        world.setDynamicProperty('dorios:consumeInterval', nextConsumeInterval);
                        world.setDynamicProperty('dorios:hungerCost', nextHungerCost);
                        world.setDynamicProperty('dorios:saturationCost', nextSaturationCost);
                        world.setDynamicProperty('dorios:breakDelayEvery', nextBreakDelayEvery);
                        world.setDynamicProperty('dorios:breakDelayTicks', nextBreakDelayTicks);

                        playerMessage(player, '§aAdvanced mining settings updated');
                        adminMenu(player);
                    });
                break;

            // ===== Back =====
            case 9:
                configMenu(player);
                break;
        }
    });
}



world.beforeEvents.playerBreakBlock.subscribe(e => {
    const { player, block } = e

    if (player.getDynamicProperty("dorios:isAdding")) {
        if (blacklist.includes(block.typeId)) {
            playerMessage(player, '§cBlock is on the black list')
            e.cancel = true;
            player.setDynamicProperty('dorios:isAdding', false)
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

        if (veinList.includes(block.typeId)) {
            playerMessage(player, '§cBlock already added')
        } else {
            veinList.push(block.typeId);
            player.setDynamicProperty("dorios:veinList", JSON.stringify(veinList));
            playerMessage(player, '§aBlock successfully added')
        }

        e.cancel = true
        player.setDynamicProperty('dorios:isAdding', false)
        return;
    }

    if (player.getDynamicProperty("dorios:isBlacklistAdding")) {
        if (blacklist.includes(block.typeId)) {
            playerMessage(player, '§cBlock already added')
        } else {
            blacklist.push(block.typeId);
            world.setDynamicProperty("dorios:veinBlacklist", JSON.stringify(blacklist));
            playerMessage(player, '§aBlock successfully added')
        }

        e.cancel = true
        player.setDynamicProperty('dorios:isBlacklistAdding', false)
        return;
    }

    if (player.getDynamicProperty("dorios:isDefaultAdding")) {
        if (blacklist.includes(block.typeId)) {
            playerMessage(player, '§cBlock is on the black list')
            e.cancel = true;
            player.setDynamicProperty('dorios:isDefaultAdding', false)
            return;
        }
        if (list.includes(block.typeId)) {
            playerMessage(player, '§cBlock already added')
        } else {
            list.push(block.typeId);
            world.setDynamicProperty("dorios:initialVein", JSON.stringify(list));
            playerMessage(player, '§aBlock successfully added')
        }

        e.cancel = true
        player.setDynamicProperty('dorios:isDefaultAdding', false)
        return;
    }
})    