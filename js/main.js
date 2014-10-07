var Game = {
	'version': 2,
	'now': function () {
		return new Date();
	},
	'lastUpdate': new Date(),
	'timeDiff': function () {
		return (Game.now() - Game.lastUpdate) || 0;
	},
	'cLight': 1079252848.8,
	'speed': 0,
	'clicks': 0,
	'clickEnergy': 1,
	'totalEnergy': 0,
	'criticalChance': 0.05,
	'criticalMultiplier': 2,
	'distance': 0,
	's': 0.005,
	'upgrades': upgrades,
	'speedLevels': speedLevels,
	'addClickParticle': function (html, x, y, critical) {

		$('<div class="clickParticle">')
			.html(html)
			.css({
				'top': y - 45 + Math.floor(Math.random() * 60),
				'left': x - 45 + Math.floor(Math.random() * 60),
				'font-size': (critical) ? '1200%' : '300%',
				'color': (critical) ? '#d4a32c' : '#FFF'
			})
			.appendTo($('#spaceship'))
			.animate({
				top: "+=300px",
				left: "-=500px",
				opacity: 0
			},
			{
				duration: 2000 - 500 + Math.floor(Math.random() * 1000),
				complete: function () {
					$(this).remove();
				}
			});
	},
	'animateSpaceship': function () {

		var $spaceship = $('#spaceship');

		var anim = function (xOrig, yOrig) {
			var x = Math.floor(xOrig - 10 + (Math.random() * 20));
			var y = Math.floor(yOrig - 20 + (Math.random() * 40) + 40);

			$spaceship.animate({
				'left': x,
				'top': y
			}, 3500, function () {
				anim(xOrig, yOrig);
			});

		};

		anim(parseInt(Math.floor(window.innerWidth / 2) - ($spaceship.width() / 2)), parseInt(Math.floor(window.innerHeight / 2) - ($spaceship.height() / 2)));
	},
	'cost': function (level, baseCost) {
		return (level) ? baseCost * Math.pow(1.15, level) : baseCost;
	},
	'buy': function (upgrade) {
		if ( upgrade.cost <= Game.totalEnergy ) {
			Game.totalEnergy -= upgrade.cost;
			upgrade.level++;
			upgrade.cost = Game.cost(upgrade.level, upgrade.baseCost);
		}
	},
	'getSpeedLevel': function () {
		var level = false;
		Game.speedLevels.forEach(function (speedLevel) {
			if ( Game.speed >= (speedLevel.speed * Game.cLight) ) {
				level = speedLevel;
			}
		});

		return level;
	},
	'setSpeed': function (speedLevel) {

		if ( speedLevel.cost <= Game.totalEnergy ) {
			Game.speed = speedLevel.speed * Game.cLight;
			var speedFactor = Math.pow(speedLevel.cost / Game.speedLevels[ Game.speedLevels.length - 1 ].cost, 0.2);
			Game.s = (speedFactor) ? speedFactor : 0.005
		}

		s = Game.s;
	},
	'updateDistance': function () {
		var diff = Game.timeDiff() / 1000 / 60 / 60;
		Game.distance += Game.speed * diff;
	},
	'energyPerSecond': 0,
	'updateEnergyPerSecond': function () {
		var eps = 0;

		Game.updateEnergyCostPerSecond();
		for ( var i = 0; i < Game.upgrades.length; i++ ) {
			if ( Game.upgrades[ i ].level > 0 ) {
				eps += Game.upgrades[ i ].level * Game.upgrades[ i ].energy;
			}
		}
		Game.energyPerSecond = eps - Game.energyCostPerSecond;

		return true;
	},
	'updateEnergyCostPerSecond': function () {
		var speedLevel = Game.getSpeedLevel();
		Game.energyCostPerSecond = speedLevel.cost;
		return Game.energyCostPerSecond;
	},
	'updateEnergy': function () {
		Game.updateEnergyPerSecond();

		Game.totalEnergy += Game.energyPerSecond * ( Game.timeDiff() / 1000);

		if ( Game.totalEnergy <= 0 ) {
			Game.totalEnergy = 0;
			Game.setSpeed( Game.speedLevels[0] );
		}
	},
	'updateUpgrades': function () {
		Game.upgrades.forEach(function (upgrade) {
			upgrade.color = (upgrade.cost <= Game.totalEnergy) ? '#fff' : '#777';
		});
	},
	'updateSpeedLevels': function () {
		var speedPercentage,
			hsv,
			i = 1;

		Game.speedLevels.forEach(function (speedLevel) {
			speedLevel.color = (speedLevel.cost <= Game.totalEnergy) ? (speedLevel.cost <= ( Game.energyPerSecond + Game.energyCostPerSecond ) ) ? '#fff' : '#ff6600' : '#777';

			if (Game.speed >= (speedLevel.speed * Game.cLight)) {

				speedPercentage = i / Game.speedLevels.length * 100 ;

				hsv = percent2hsv(speedPercentage);
				speedLevel.bgcolor = hsv2rgb(hsv.h,hsv.s,hsv.v)
			}
			else {
				speedLevel.bgcolor = 'transparent';
			}

			i++;
		});
	},
	'save': function () {
		localStorage[ "continuumClicker.game" ] = JSON.stringify( Game );
		localStorage[ "continuumClicker.version" ] = Game.version;

		$('<div class="save">').html('Game saved').appendTo('body').fadeIn('slow', function () {
			$(this).fadeOut(4000, function () {
				$(this).remove();
			})
		});

		return true;
	},
	'resume': function () {
		//if (!supportsLocalStorage()) { return false; }
		var saveGame;
		if ( parseInt(localStorage[ "continuumClicker.version" ]) >= Game.version ) {
			saveGame = JSON.parse(localStorage["continuumClicker.game"]);

			Game.clickEnergy = saveGame.clickEnergy;
			Game.clicks = saveGame.clicks;
			Game.criticalChance = saveGame.criticalChance;
			Game.criticalMultiplier = saveGame.criticalMultiplier;
			Game.distance = saveGame.distance;
			Game.energyCostPerSecond = saveGame.energyCostPerSecond;
			Game.energyPerSecond = saveGame.energyPerSecond;
			Game.lastUpdate = new Date(saveGame.lastUpdate);
			Game.s = saveGame.s;
			Game.speed = saveGame.speed;
			Game.speedLevels = saveGame.speedLevels;
			Game.totalEnergy = saveGame.totalEnergy;
			Game.upgrades = saveGame.upgrades;

			return true;
		}

		return false;
	},
	'resetGame': function () {
		localStorage.clear();
	},
	init: function () {

		Game.resume();

		Game.upgrades.forEach(function (upgrade) {
			upgrade.cost = Game.cost(upgrade.level, upgrade.baseCost);
			upgrade.color = (upgrade.cost <= Game.totalEnergy) ? '#fff' : '#777';
		});

		Game.speedLevels.forEach(function (speedLevel) {
			speedLevel.cost = Math.ceil(speedLevel.speed / 0.0008895);
			speedLevel.color = (speedLevel.cost <= Game.totalEnergy) ? ( Game.energyPerSecond + Game.energyCostPerSecond ) ? '#fff' : '#ff6600' : '#777';
			speedLevel.calculatedSpeed = speedLevel.speed * Game.cLight;
		});

		rivets.formatters.cost = Game.cost;
		rivets.formatters.beautify = Beautify;
		rivets.binders.color = function (el, value) {
			el.style.color = value;
		};
		rivets.binders.bgcolor = function (el, value) {
			el.style.backgroundColor = value;
		};

		rivets.bind($('#game'), {
			game: this,

			controller: {
				'buy': function (e, data) {
					Game.buy(data.upgrade);
				},
				'setSpeed': function (e, data) {
					Game.setSpeed(data.speed);
				}
			}
		});

		$('#spaceship').mousedown(function (e) {
			var critical,
				energy;

			Game.clicks++;

			critical = (Math.random() * 100) < (Game.criticalChance * 100);

			energy = (critical) ? Game.clickEnergy * Game.criticalMultiplier : Game.clickEnergy;

			Game.addClickParticle(energy, e.clientX, e.clientY, critical);
			Game.totalEnergy += energy;
		});
	},
	start: function () {

		Game.animateSpaceship();

		setInterval(function () {
			Game.updateEnergy();
			Game.updateUpgrades();
			Game.updateSpeedLevels();
			Game.updateDistance();

			Game.lastUpdate = Game.now();
		}, 50);

		setInterval(function () {
			Game.save();
		}, 30000);
	}
};

$(function () {
	Game.init();
	Game.start();
});