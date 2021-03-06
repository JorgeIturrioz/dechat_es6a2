const n3 = require("n3");
const newEngine = require("@comunica/actor-init-sparql-rdfjs").newEngine;
const Q = require("q");
const streamify = require("streamify-array");
const namespaces = require("../namespaces");
const SemanticChat = require("../semanticchat");
const Group = require("../Group");

/**
 * The Loader allows creating a Semantic Chat instance via information loaded from an url.
 */
class SolidLoaderRepository {

    /**
     * This constructor creates an instance of Loader.
     * @param fetch: the function used to fetch the data
     */
    constructor(fetch) {
        this.engine = newEngine();
        this.fetch = fetch;
    }

	async loadChatFromUrl(chatUrl, userWebId, chatBaseUrl) {
        const chat = new SemanticChat({
            url: chatUrl,
            chatBaseUrl,
            userWebId
        });
        return await this.loadFromUrl(chat, chatUrl);
    }

	async loadGroupFromUrl(chatUrl, userWebId, chatBaseUrl) {

		//console.log("Interlocutor group");
		var ids = await this.findWebIdOfInterlocutor(chatUrl, userWebId);

        const chat = new Group({
            url: chatUrl,
            chatBaseUrl,
            userWebId,
			      members: ids
        });

		//console.log(chat);
        return await this.loadFromUrl(chat, chatUrl);
    }

    /**
     * This method loads the messages from the url passed through the parameter
     */
    async loadFromUrl(chat, chatUrl) {
		
		//console.log("Loading from url");

        const messages = await this._findMessage(chatUrl);

        for (var i = 0, len = messages.length; i < len; i++) {
            chat.loadMessage(messages[i]);
        }
        return chat;
    }

    /**
     * This method is in charge of finding the message through the message url
     */
    async _findMessage(messageUrl) {
        const deferred = Q.defer();
        let results = [];

        const rdfjsSource = await this._getRDFjsSourceFromUrl(messageUrl);
        let nextMessageFound = false;
        this.engine.query(`SELECT * {
		?message a <${namespaces.schema}Message>;
		<${namespaces.schema}dateSent> ?time;
		<${namespaces.schema}givenName> ?username;
		<${namespaces.schema}text> ?msgtext. }`, {
                sources: [{
                    type: "rdfjsSource",
                    value: rdfjsSource
                }]
            })
            .then(function(result) {
                result.bindingsStream.on("data", (data) => {
                    data = data.toObject();
                    if (data["?msgtext"]) {
                        var messageText = data["?msgtext"].value.split("/")[4];
                        var author = data["?username"].value.split("/").pop();
                        results.push({
                            messagetext: messageText.replace(/U\+0020/g, " ").replace(/U\+003A/g, ":"),
                            url: data["?message"].value,
                            author: author.replace(/U\+0020/g, " "),
                            time: data["?time"].value.split("/")[4]
                        });
                    }
                });

                result.bindingsStream.on("end", function() {
                    deferred.resolve(results);
                });
            });

        return deferred.promise;
    }

    /**
     * This method is in charge of finding the webId of the user"s friend
     */
    async findWebIdOfInterlocutor(chatUrl, userWebId) {
        const deferred = Q.defer();
		let results = [];
        const rdfjsSource = await this._getRDFjsSourceFromUrl(chatUrl);

        this.engine.query(`SELECT * {
      ?invitation a <${namespaces.schema}InviteAction>;
			<${namespaces.schema}event> ?url;
			<${namespaces.schema}agent> ?agent;
			<${namespaces.schema}recipient> ?recipient.
    }`, {                sources: [{
                    type: "rdfjsSource",
                    value: rdfjsSource
                }]
            })
			.then(function(result) {
                result.bindingsStream.on("data", (data) => {
                    data = data.toObject();
                    if (data["?recipient"]) {
                        results.push(data["?recipient"]);
                    }
                });

                result.bindingsStream.on("end", function() {
                    deferred.resolve(results);
                });
            });
        return deferred.promise;
    }

    /**
     * This method is in charge of returning the RDFjs source from the url
     */
    _getRDFjsSourceFromUrl(url) {
        const deferred = Q.defer();

        this.fetch(url)
            .then(async (res) => {
                if (res.status === 404) {
                    deferred.reject(404);
                } else {
                    const body = await res.text();
                    const store = n3.Store();
                    const parser = n3.Parser({
                        baseIRI: res.url
                    });

                    parser.parse(body, (err, quad, prefixes) => {
                        if (err) {
                            deferred.reject();
                        } else if (quad) {
                            store.addQuad(quad);
                        } else {
                            const source = {
                                match: function(s, p, o, g) {
                                    return streamify(store.getQuads(s, p, o, g));
                                }
                            };

                            deferred.resolve(source);
                        }
                    });
                }
            });

        return deferred.promise;
    }
}

module.exports = SolidLoaderRepository;
