Hooks.once("init", () => {
	CONFIG.AmbientLight.objectClass = mixin(CONFIG.AmbientLight.objectClass);
	CONFIG.Token.objectClass = mixin(CONFIG.Token.objectClass);
});

Hooks.on('init', () => {

	game.settings.register("dnd5e-night-vision", "onlyOnSelection", {
		name: "Darkvision requires selection",
		hint: "With this setting on, players must select a token to see with Darkvision",
		scope: "world",
		config: true,
		default: false,
		type: Boolean,
		onChange: () => {
			canvas.perception.update(
				{ initializeLighting: true, initializeVision: true, refreshLighting: true, refreshVision: true },
				true
			);
		},
	});

	game.settings.register("dnd5e-night-vision", "nightVisionDistance", {
		name: "Darkvision range",
		hint: "Distance in meters per 60ft of Darkvision.",
		scope: "world",
		config: true,
		default: 20,
		type: Number,
		step: "any",
		onChange: () => {
			canvas.perception.update(
				{ initializeLighting: true, initializeVision: true, refreshLighting: true, refreshVision: true },
				true
			);
		},
	});

	game.settings.register("dnd5e-night-vision", "nightVisionBright", {
		name: "Darkvision affects bright illumination",
		hint: "With this setting on, Darkvision also increases the radius of bright illumination by half the value of dim illumination",
		scope: "world",
		config: true,
		default: false,
		type: Boolean,
		onChange: () => {
			canvas.perception.update(
				{ initializeLighting: true, initializeVision: true, refreshLighting: true, refreshVision: true },
				true
			);
		},
	});

});



Hooks.on('renderSceneConfig', async (obj) => {
	if (!obj.isEditable) return;

	if (!foundry.utils.hasProperty(obj.document, 'flags.dnd5e-night-vision.disable')) {
		await obj.document.setFlag('dnd5e-night-vision', 'disable', false);
	}

	const disableNightVision = obj.document.getFlag('dnd5e-night-vision', 'disable') ? 'checked' : '';
	const injection = `
	  <fieldset class="nv-scene-config">
		<div class="form-group">
		  <label>Disable Darkvision</label>
		  <input
			type="checkbox"
			name="flags.dnd5e-night-vision.disable"
			${disableNightVision}>
		  <p class="hint">Disable Darkvision functionality on this scene</p>
		</div>
		</fieldset>`;

	if ($(obj.form).find('.nv-scene-config').length === 0) {
		$(obj.form)
			.find('p:contains("' + game.i18n.localize('SCENE.FIELDS.environment.darknessLock.hint') + '")')
			.parent()
			.after(injection);
	}
	obj.setPosition();

});


Hooks.on('renderAmbientLightConfig', async (obj) => {

	const light = obj.document;

	const bf = new foundry.data.fields.BooleanField();

	const el = bf.toFormGroup(
		{
			label: "Disable Darkvision",
			hint: "Darkvision ignores this light source",
		},
		{
			name: "flags.dnd5e-night-vision.disable",
			value: light.getFlag('dnd5e-night-vision', 'disable') ?? false,
		}
	);

	const field = document.createElement("fieldset");
	const legend = document.createElement("legend");
	legend.innerText = "D&D 5e Darkvision";
	field.append(legend, el);

	$(obj.form).find('section.tab[data-tab="advanced"]').append(field);
});


Hooks.on("renderTokenConfig", async (obj) => {
	const light = obj.document;

	const bf = new foundry.data.fields.BooleanField();

	const el = bf.toFormGroup(
		{
			label: "Disable Darkvision",
			hint: "Darkvision ignores this light source",
		},
		{
			name: "flags.dnd5e-night-vision.disable",
			value: light.getFlag('dnd5e-night-vision', 'disable') ?? false,
		}
	);

	const field = document.createElement("fieldset");
	const legend = document.createElement("legend");
	legend.innerText = "D&D 5e Darkvision";
	field.append(legend, el);

	$(obj.form).find('.tab[data-tab="light"]').append(field);
});



let multiplier = { dim: 0, bright: 0 };
let nightVisionDistance = 0;
let distancePix = 0;


const mixin = Base =>
	class extends Base {
		/** @override */
		_getLightSourceData() {
			const data = super._getLightSourceData();

			const { dim, bright } = this.getRadius(data.dim, data.bright);

			if (data.dim !== undefined) data.dim = dim;
			if (data.bright !== undefined) data.bright = bright;

			return data;

		}

		getRadius(dim, bright) {
			const result = { dim, bright };
			multiplier = { dim: 0, bright: 0 };

			if (this.document.getFlag('dnd5e-night-vision', 'disable') === true) return result;

			const gmSelection = game.user.isGM || game.settings.get("dnd5e-night-vision", "onlyOnSelection");
			const controlledtoken = canvas.tokens.controlled;
			let relevantTokens;

			if (controlledtoken.length) {
				relevantTokens = canvas.tokens.placeables.filter(
					(o) =>
						!!o.actor && o.actor?.testUserPermission(game.user, "OBSERVER") && o.controlled
				);
			} else {
				relevantTokens = canvas.tokens.placeables.filter(
					(o) =>
						!!o.actor && o.actor?.testUserPermission(game.user, "OBSERVER") && (gmSelection ? o.controlled : true)
				);
			};

			if (gmSelection && relevantTokens.length) {
				multiplier = { dim: 999, bright: 999 };

				for (const t of relevantTokens) {
					// D&D 5e: Check darkvision from actor senses
					const darkvision = t.actor?.system?.attributes?.senses?.darkvision ?? 0;
					const dvMultiplier = darkvision > 0 ? darkvision / 60 : 0; // Normalize to 60ft = 1x
					multiplier.dim = Math.min(multiplier.dim, dvMultiplier);
					multiplier.bright = Math.min(multiplier.bright, dvMultiplier);
				}
			} else {
				for (const t of relevantTokens) {
					// D&D 5e: Check darkvision from actor senses
					const darkvision = t.actor?.system?.attributes?.senses?.darkvision ?? 0;
					const dvMultiplier = darkvision > 0 ? darkvision / 60 : 0; // Normalize to 60ft = 1x
					multiplier.dim = Math.max(multiplier.dim, dvMultiplier);
					multiplier.bright = Math.max(multiplier.bright, dvMultiplier);
				}
			}

			distancePix = game.scenes.viewed.dimensions.distancePixels;
			nightVisionDistance = game.settings.get("dnd5e-night-vision", "nightVisionDistance");

			if (game.scenes.viewed.getFlag('dnd5e-night-vision', 'disable') !== true) {

				result.dim += multiplier.dim * nightVisionDistance * distancePix;

				if (game.settings.get("dnd5e-night-vision", "nightVisionBright")) {
					result.bright += multiplier.bright * nightVisionDistance / 2 * distancePix;
				}
			}

			return result;
		}
	};

const reinitLights = function () {
	for (const { object } of canvas.effects.lightSources) {
		if (!((object instanceof AmbientLight) || (object instanceof Token))) continue;
		object.initializeLightSource();
	}
}

const Debouncer = foundry.utils.debounce(reinitLights, 10);

Hooks.on("controlToken", () => {
	Debouncer();
});
