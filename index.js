'use strict';

var _ = require('lodash');
var Alexa = require('alexa-app');
var Speech = require('ssml-builder');
module.change_code = 1;
_.templateSettings.interpolate = /{{([\s\S]+?)}}/g;
var Sentences = {
	PRE_LETTER_ANNOUNCE_REPEAT: 'The letters are',
	PRE_LETTER_ANNOUNCE: 'The letters of the {{count}} word are',
	TRY_NEW: 'Do you want to try a new word?',
	INVALID_NUMBER: 'Sorry, I didn\'t hear a valid number.',
	GAME_OBJECTIVE: 'Rearrange the letters to find the hidden word.',
	ERROR: 'Sorry, something went wrong!',
	VALID_NUMBER_WARNING: 'You may only pick a number between 3 and 10',
	SUCCESS_MESSAGE: 'Nice, you scored ${ score } points!',
	FAILURE_MESSAGE: 'Sorry, that was incorrect. The word is ${ word }',
	WORD_DEFINITION: 'See app for more information about ${ word }',
	DIFFICULTY_LEVEL: 'Difficulty level set at ${ level }.',
	NO_INTENT_FOUND: 'Sorry, I didn\'t understand that.'
};

var APP_NAME = 'letterjumble'
var WORDNET_API_KEY = '3276577be2ae91290e0020d0368094825231c2b7a4fcf6ebb';
var DEFAULT_LEVEL = 5;
var app = new Alexa.app(APP_NAME);
app.persistentSession = true;
app.messages.NO_INTENT_FOUND = Sentences.NO_INTENT_FOUND;
var Swagger = require('swagger-client');
var client = null;
var swagger = new Swagger({
	url: 'https://api.apis.guru/v2/specs/wordnik.com/4.0/swagger.json',
	usePromise: true,
	authorizations: {
		api_auth: new Swagger.ApiKeyAuthorization('api_key', WORDNET_API_KEY, 'query')
	}
}).then(function(c) {
	client = c;
	console.log('connected');
}).catch(function(error) {
	console.log('error connecting to api: ' + error);
});

function announceWord(word, preText) {
	console.log('announceWord: ' + word + ' / ' + preText);
	var speech = new Speech();
	speech.say(preText);
	for(var i = 0; i < word.length; i++) {
		speech.pause('500ms');
		speech.say(word[i]);
	}
	return speech.ssml(true);
}

function loadWords(level) {
	return getRandomWords(level).then(function(data) {
		var newWords = data.obj.map(function(o) {
			return o.word;
		});
		return _.uniq(newWords);
    }).catch(function(error) {
		return Promise.reject(new Error(error));
	});
}

function setLevel(res, level) {
	console.log('setLevel: ' + level);
	if (level >= 3 && level <= 10) {
		res.session('level', level);
		res.session('words_fetched', []);
		res.say(_.template(Sentences.DIFFICULTY_LEVEL)('level', level));
	} else if(level < 3 || level > 10) {
		res.say(Sentences.VALID_NUMBER_WARNING);
	} else {
		res.say(Sentences.INVALID_NUMBER);
	}
	return Promise.resolve(res);
}

function getRandomWords(length) {
	console.log('getRandomWords: ' + length);
	return client.words.getRandomWords({
		hasDictionaryDef: true,
		// includePartOfSpeech: ['adverb', 'adjective', 'auxiliary-verb', 'verb'].join(','),
		// excludePartOfSpeech	: ['abbreviation', 'affix', 'article', 'conjunction', 'definite-article', 'family-name', 'given-name', 'idiom', 'imperative', 'noun', 'pronoun', 'preposition', 'noun-plural', 'noun-posessive', 'past-participle', 'phrasal-prefix', 'proper-noun', 'proper-noun-plural', 'proper-noun-posessive', 'suffix', 'verb-intransitive', 'verb-transitive'].join(','),
		minCorpusCount: 0,
		maxCorpusCount: 0,
		minDictionaryCount: 0,
		maxDictionaryCount: 0,
		minLength: length,
		maxLength: length,
		sortBy: 'alpha',
		sortOrder: 'asc',
		limit: 100
	}, {
		responseContentType: 'application/json'
	});
}

function getNextWord(randomWord) {
	var shuffledWord = _.shuffle(randomWord.toUpperCase().split(''));
	return {
		id: _.uniqueId('word_'),
		word: randomWord,
		shuffled: shuffledWord,
		score: 0,
		timestamp: Date.now(),
		guessTimestamp: 0,
		guesses: []
	};
}

function getWordDefinition(word) {
	return client.word.getDefinitions({
		word: word,
		limit: 3
	}, {
		responseContentType: 'application/json'
	});
}

app.intent('answer',{
		'slots':{'GUESS':'LITERAL'},
		'utterances':['{the |}{first|second|third} word is {-|GUESS}']
	},
	function(req, res) {
		
		var isCorrect = false;
		var guesses = _.uniq(_.words(req.slot('GUESS')));
		var wordsAttempted = req.session('words');
		var o = _.first(wordsAttempted);

		_.forEach(guesses, function(guess) {

			if(guess === o.word) {
				isCorrect = true;
			} else if(guess.length === o.word.length) {
				var chars = _.toLower(guess).split('');
				var word = _.toLower(o.word);
				for (var i = chars.length - 1; i >= 0; i--) {
					var index = word.indexOf(char[i]);
					if(index === -1) {
						isCorrect = false;
						break;
					} else {
						word = word.substr(0, index) + word.substr(index+1);
					}
				}
			}
		});

		var speech = new Speech();
		var speechOutput;
		if(isCorrect) {
			var score = o.word.length * 10;
			speech.say(_.template(Sentences.SUCCESS_MESSAGE)('score', score));
			speech.say(_.template(Sentences.WORD_DEFINITION)('word', o.word));
			speechOutput = speech.ssml(true);
			res.say(speechOutput).reprompt(Sentences.TRY_NEW).shouldEndSession(false);
			res.send();

			wordsAttempted[0].score = score;

			getWordDefinition(o.word).then(function(data) {
				res.card({
				  type: 'Standard',
				  title: o.word,
				  text:  _.first(data.obj).def.text,
				  image: {
				    
				  }
				});
		    });
		} else {
			speech.say(_.template(Sentences.FAILURE_MESSAGE)('word', o.word));
			speechOutput = speech.ssml(true);
			res.say(speechOutput).reprompt(Sentences.TRY_NEW).shouldEndSession(false);
			res.send();
		}
		

		return false;
	}
);

app.intent('AMAZON.RepeatIntent',{
	},
	function(req,res) {

		var wordsAttempted = res.session('words');
		var lastWord = wordsAttempted[0];
		var shuffledWord = lastWord.shuffled;

		var speechOutput = announceWord(shuffledWord, Sentences.PRE_LETTER_ANNOUNCE_REPEAT);
		res.shouldEndSession(false, speechOutput);
	}
);

app.intent('AMAZON.NextIntent',{
	},
	function(req, res) {
		return false;
	}
);

app.intent('AMAZON.HelpIntent',{
	
	},
	function(req,res) {
		var speech = new Speech();
		speech.say(Sentences.GAME_OBJECTIVE);
		speech.say('Length of words can be controlled, say ');
		speech.pause('1s');
		speech.say('set level followed by a number between 3 and 10');
		speech.say('To answer, say ');
		speech.pause('1s');
		speech.say('the word is followed by your guess');
		var speechOutput = speech.ssml(true);
		res.shouldEndSession(false, speechOutput);
	}
);

app.intent('level',{
		'slots': {'LEVEL_NUMBER':'NUMBER'},
		'utterances': [
			'set {the| }{difficulty|level} {|at |to }{3-10|LEVEL_NUMBER}'
		]
	},
	function(req, res) {
		var level = req.slot('LEVEL_NUMBER');
		setLevel(res, level).then(function() {
			res.send();
		});
	}
);

app.intent('AMAZON.StopIntent',{
	},
	function(req, res) {
		response.shouldEndSession(true);
	}
);

app.intent(APP_NAME, {
		'slots': {'LEVEL_NUMBER':'NUMBER'},
		'utterances': [
			'play {|the game }' + APP_NAME + ' {|with |at |and set} {difficulty|level} {|at|to }{3-10|LEVEL_NUMBER}',
			'launch {|the game }' + APP_NAME + ' {|with |at |and set} {difficulty|level} {|at|to }{3-10|LEVEL_NUMBER}',
			'start {|the game }' + APP_NAME + ' {|with |at |and set} {difficulty|level} {|at|to }{3-10|LEVEL_NUMBER}',
			'begin {|the game }' + APP_NAME + ' {|with |at |and set} {difficulty|level} {|at|to }{3-10|LEVEL_NUMBER}',
			'open {|the game }' + APP_NAME + ' {|with |at |and set} {difficulty|level} {|at|to }{3-10|LEVEL_NUMBER}',
			'run {|the game }' + APP_NAME + ' {|with |at |and set} {difficulty|level} {|at|to }{3-10|LEVEL_NUMBER}',
			'start playing {|the game }' + APP_NAME + ' {|with |at |and set} {difficulty|level} {|at|to }{3-10|LEVEL_NUMBER}',
			'begin playing {|the game }' + APP_NAME + ' {|with |at |and set} {difficulty|level} {|at|to }{3-10|LEVEL_NUMBER}'
		]
	},
	function(req, res) {
		var level = parseInt(req.slot('LEVEL_NUMBER') ? req.slot('LEVEL_NUMBER') : req.session('level'));
		setLevel(res, level).then(function(res) {
			playLevel(level, req, res).then(function(res) {
				res.send();
			});	
		});
		
	    return false;
	}
);

app.error = function(exception, request, response) {
    response.say(Sentences.ERROR);
};

app.sessionEnded(function(request,response) {
    // Clean up the user's server-side stuff, if necessary
    console.log('Session ended!');
    // No response necessary
});

app.launch(function(req,res) {
	console.log('launch');
	res.session('level', DEFAULT_LEVEL);
	
	loadWords(DEFAULT_LEVEL).then(function(words) {
		var randomWord = words[_.random(0, words.length)];
		var wordsList = _.without(words, randomWord);
		console.log('Random Word: ' + randomWord);
		console.log('Word list: ' + wordsList.length);
		var o = getNextWord(randomWord);
		var wordsPlayed = [o];
		res.session('words_list', wordsList);
		res.session('words', wordsPlayed);
		
		var speechOutput = announceWord(o.shuffled, _.template(Sentences.PRE_LETTER_ANNOUNCE)({ 'count': 'first' }));
		res.say(speechOutput);
		res.shouldEndSession(false);
		res.send();
	});

	return false;
});

module.exports = app;