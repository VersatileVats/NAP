"use strict";

const cors = require("cors");
const Nylas = require("nylas");

// setting up a connection with the database
const knex = require("knex")({
  client: "mysql",
  connection: {
    host: process.env.DB_IP,
    user: process.env.DB_USER,
    password: process.env.DB_PWD,
    database: process.env.DB_NAME,
  },
});

// Imports dependencies and set up http server
const request = require("request"),
  express = require("express"),
  body_parser = require("body-parser"),
  axios = require("axios").default,
  app = express().use(body_parser.json());

app.use(cors());
app.listen(process.env.PORT || 1337, () =>
  console.log("App is up and running")
);

app.get("/", async (req, res) => {
  res.send("I am going to win this hackathon for sure ✌");
});

// backend handler for the sync-table:
app.post("/getEmails", async (req, res) => {
  const body = req.body;

  if (
    body.clientID == null ||
    body.clientId == "" ||
    body.clientSecret == null ||
    body.clientSecret == "" ||
    body.accessToken == null ||
    body.accessToken == ""
  ) {
    res.status(400).send("ERROR:Please provide the required credentials");
    return;
  }

  Nylas.config({
    clientId: body.clientID,
    clientSecret: body.clientSecret,
  });

  const nylas = Nylas.with(body.accessToken);

  // requestnig the Nylas account for the passed variables
  try {
    await nylas.account
      .get()
      .then((account) =>
        console.log(
          `Account Id is: ${account.id} & email is: ${account.emailAddress}`
        )
      );

    // setting up the offset
    let blockOffset = Math.floor(body.blockOffset)
      ? body.blockOffset * 8
      : 0 * 8;
    console.log(`Block Offset is: ${blockOffset}`);

    console.log("\nRECENT email threads: ");
    let result = [];

    // Return the 8 most recent email threads (Also including the offset)
    await nylas.messages
      .list({ limit: 8, in: "inbox", offset: blockOffset })
      .then(async (messages) => {
        for (let message of messages) {
          /* have to parse the message through the CONVERSATION Neural API endpoint to get the meaningful text out of the email body
          and trim out the gibberish from the body*/
          let data = JSON.stringify({
            message_id: [message.id],
            ignore_links: true,
            ignore_images: true,
            ignore_tables: true,
            remove_conclusion_phrases: true,
            images_as_markdown: true,
          });

          let config = {
            method: "put",
            maxBodyLength: Infinity,
            url: "https://api.nylas.com/neural/conversation",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              Authorization: `Bearer ${body.accessToken}`,
            },
            data: data,
          };

          // fetching the trimmed conversation
          let emailText = await axios
            .request(config)
            .then((response) => {
              return response.data[0].conversation;
            })
            .catch((err) => {
              console.log(err.name + ": " + err.type);
              res.status(400).send("SOME ERROR OCCURED");
            });

          // pushing the results so that the Coda can interpret the results
          result.push({
            subject: message.subject,
            date: message.date,
            sender: message.from[0].email,
            emailContent: emailText,
            deliveredTo: message.to[0].email,
          });
        }
      });
    res.status(200).send(result);
  } 
  // handling any error in  the above calls
  catch (err) {
    console.log(err.name + ": " + err.type);
    res.status(400).send("SOME ERROR OCCURED");
  }
});

// backend handler for the sync-table: getContacts
app.post("/getContacts", async (req, res) => {
  const body = req.body;

  if (
    body.clientID == null ||
    body.clientId == "" ||
    body.clientSecret == null ||
    body.clientSecret == "" ||
    body.accessToken == null ||
    body.accessToken == ""
  ) {
    res.status(400).send("ERROR:Please provide the required credentials");
    return;
  }

  Nylas.config({
    clientId: body.clientID,
    clientSecret: body.clientSecret,
  });

  const nylas = Nylas.with(body.accessToken);

  try {
    await nylas.account
      .get()
      .then((account) =>
        console.log(
          `Account Id is: ${account.id} & email is: ${account.emailAddress}`
        )
      );

    let result = [];

    /* only looking for the address_book contacts & skipping over the email contacts 
    I am not limiting the contacts to be fetched here*/
    await nylas.contacts
      .list({ source: "address_book" })
      .then(async (contacts) => {
        console.log(`${contacts.length} contacts fetched`);

        for (let contact of contacts) {
          let mobile = "",
            email = "",
            address = "";
          contact.phoneNumbers.forEach((phone) => {
            // checking whether the contact is having a valid MOBILE NUMBER or not
            if (phone.type === "Mobile") {
              mobile = phone.number;
            }
          });

          // mail should also be there
          if (contact.emailAddresses.length > 0)
            email = contact.emailAddresses[0].email;

          // physical address should be there
          if (contact.physicalAddresses.length > 0)
            address = contact.physicalAddresses[0].address;

          // have to provide only the contacts whose birthday is in the next 7 days
          if (contact.birthday != "") {
            const currDate = new Date();
            const birthdate = new Date(contact.birthday).setFullYear(
              currDate.getFullYear()
            );

            // calculting the differenve between today and the contact's birthdate
            const diff = Math.floor(
              (birthdate - currDate.getTime()) / (1000 * 60 * 60 * 24)
            );
            
            // only sending to the frontend, if the diff <= 7
            if (diff >= 0 && diff <= 7) {
              
              // checking whether the automation has already been done or not?
              const wishes = await knex("nylas").select("*");
              let isAutomated = false;

              // if there are some rows in the "nylas" table representing wishes
              if (wishes.length) {
                const particularWish = await knex("nylas")
                  .select("*")
                  .where({
                    contactName: `${contact.givenName} ${contact.middleName} ${contact.surname}`,
                    contactPhone: `${mobile.split(" ").join("")}`,
                    dob: `${contact.birthday}T00:00:00.000Z`,
                  });
                
                // if the automation is already there
                if (particularWish.length) {
                  isAutomated = true;
                }
              }

              // pushing the results
              result.push({
                name: `${contact.givenName} ${contact.middleName} ${contact.surname}`,
                mail: `${email}`,
                phone: `${mobile.split(" ").join("")}`,
                dob: `${contact.birthday}`,
                isAutomated: `${isAutomated}`,
              });
            }
          }
        }
      });
    res.status(200).send(result);
  } catch (err) {
    console.log(err.name + ": " + err.type);
    res.status(400).send("SOME ERROR OCCURED");
  }
});

// backend handler for automating the wishing process
app.post("/automate", async (req, res) => {
  const body = req.body;

  // checking if the wish has been automated already or not
  const particularWish = await knex("nylas")
    .select("*")
    .where({
      contactName: body.contactName,
      contactPhone: body.contactPhone,
      dob: body.dob + "T00:00:00.000Z",
    });

  // if the wish is already automated!
  if (particularWish.length) {
    res.send(
      "ERROR:Wish has been already automated. Delete the current wish first"
    );
    return;
  }

  // sending an error if no message was supplied (or does have >200 characters)
  if (body.message == "" || body.message.length > 200) {
    res.send(
      "ERROR:Please provide a message that has to be sent via SMS (max 200 characters)"
    );
    return;
  }

  // if everthing goes right, then insert the automation into the db
  await knex("nylas").insert({
    contactName: body.contactName,
    contactPhone: body.contactPhone,
    dob: body.dob,
    message: body.message,
  });

  res.send("Sucess! Wish has been automated");
});

// backend handler for deleting the wishing record
app.post("/deleteAutomate", async (req, res) => {
  const body = req.body;

  // checking whether the automation is already there
  const particularWish = await knex("nylas")
    .select("*")
    .where({
      contactName: body.contactName,
      contactPhone: body.contactPhone,
      dob: body.dob + "T00:00:00.000Z",
    });

  // if there is a record for the same contact
  if (particularWish.length) {
    // have to make sure that this is the not the day of the contact's birthday
    const currDate = new Date();
    const birthdate = new Date(particularWish[0].dob).setFullYear(
      currDate.getFullYear()
    );

    const diff = (birthdate - currDate.getTime()) / (1000 * 60 * 60 * 24);

    // user can't delete the automated wish on the birthdate itself. Can delete before that day
    if (diff < 1) {
      res.send(
        "ERROR:Your contact's birthday is today and you have already scheduled a wish for that. So, now you can't delete the same. The message that will be sent is:" +
          particularWish[0]["message"]
      );
      return;
    }

    // deleting if the diff > 1
    await knex("nylas")
      .where({
        contactName: body.contactName,
        contactPhone: body.contactPhone,
        dob: body.dob + "T00:00:00.000Z",
      })
      .delete();

    res.send("Successfully deleted");
  }
  // no particularWish is scheduled for the contact
  else {
    res.send("ERROR:No wish has been scheduled for this contact as of now!");
  }
});

// backend handler for the syncSentMail sync-table
app.post("/syncThreads", async (req, res) => {
  const body = req.body;

  if (
    body.clientID == null ||
    body.clientId == "" ||
    body.clientSecret == null ||
    body.clientSecret == "" ||
    body.accessToken == null ||
    body.accessToken == ""
  ) {
    res.status(400).send("ERROR:Please provide the required credentials");
    return;
  }

  Nylas.config({
    clientId: body.clientID,
    clientSecret: body.clientSecret,
  });

  const nylas = Nylas.with(body.accessToken);

  try {
    const userEmail = await nylas.account.get().then((account) => {
      console.log(
        `Account Id is: ${account.id} & email is: ${account.emailAddress}`
      );
      return account.emailAddress;
    });
    console.log(
      `In the syncThreads endpoint, called up by the email: ${userEmail}`
    );

    let result = [];
    let subject = "",
      initialThreadDate = "",
      sender = "",
      recentThreadDate = "",
      emailContent = "",
      participants = "",
      status = "",
      replyToMsgId = "";

    // setting up the thread block offset
    let threadBlockOffset = Math.floor(body.threadBlockOffset)
      ? body.threadBlockOffset * 4
      : 0 * 4;
    
    // Step1: Fetch the threads from the /thread endpoint (using the limit and offset parameters)
    await nylas.threads.list({ limit: 4, offset: threadBlockOffset }).then(async (threads) => {
      console.log(`${threads.length} threads fetched`);

      for (let thread of threads) {
        console.log(`\n\nThread id is: ${thread.id}`);

        // check whether there is a "Sent Mail" label or not?
        let foundSentMailLabel = false;
        thread.labels.forEach((label) => {
          if (label.displayName == "Sent Mail") foundSentMailLabel = true;
        });

        if (!foundSentMailLabel) status = "";

        console.log(`Found Sent Mail Label: ${foundSentMailLabel}`);
        
        // Step 2: Call the /messages?thread_id to get more info about the particular thread
        await nylas.messages
          .list({ thread_id: thread.id })
          .then(async (threadMsgs) => {
            
            // After this, I have to sort the messages according to the "date" (recently sent will be at the top)
            threadMsgs = threadMsgs.sort(
              (t1, t2) => (t1.date < t2.date) ? 1 : (t1.date > t2.date) ? -1 : 0); 
          
            const numOfThreads = threadMsgs.length;

            subject = threadMsgs[numOfThreads - 1].subject;
            initialThreadDate = threadMsgs[numOfThreads - 1].date;
            sender = threadMsgs[numOfThreads - 1].from[0].email.toLowerCase();

            // console.log(`Subject: ${subject}, initialThreadDate: ${initialThreadDate}, sender: ${sender}`)

            // filling up the participants array
            thread.participants.forEach((participant) => {
              if (participants == "")
                participants = participant.email.toLowerCase();
              else
                participants = `${participants}, ${participant.email.toLowerCase()}`;
            });

            // console.log(`Participants are: ${participants}`)

            // only single thread in the conversation
            if (numOfThreads == 1) recentThreadDate = initialThreadDate;
            else recentThreadDate = threadMsgs[0].date;

            replyToMsgId = threadMsgs[0].id;

            // console.log(`Recent thread date is: ${recentThreadDate}`)

            let count = 0;

            // traversing through the threadMesasges to extract the email contents
            for (let threadMsg of threadMsgs) {
              console.log(
                `Number of messages in a thread are: ${threadMsgs.length} and count is: ${count} & message id is: ${threadMsg.id}`
              );
              console.log(
                `For thread id: ${threadMsg.id}, subject: ${threadMsg.subject}, the details are: `
              );

              let data = JSON.stringify({
                message_id: [threadMsg.id],
                ignore_links: true,
                ignore_images: true,
                ignore_tables: true,
                remove_conclusion_phrases: true,
                images_as_markdown: true,
              });

              // have to parse the message of the emails through the CONVERSATION Neural API endpoint to get the meaningful text out of the email body
              let config = {
                method: "put",
                maxBodyLength: Infinity,
                url: "https://api.nylas.com/neural/conversation",
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${body.accessToken}`,
                },
                data: data,
              };

              await axios
                .request(config)
                .then((response) => {
                  let localDate = new Date(threadMsgs[count].date).toString().split("GMT")[0]
                
                  emailContent += `For the thread #${
                    numOfThreads - count
                  } sent on ${localDate} by ${
                    threadMsgs[count].from[0].email
                  }, the content is: \n\n${
                    response.data[0].conversation
                  }\n\n\n`;
                })
                .catch((err) => {
                  console.log(err.name + ": " + err.type);
                  res.status(400).send("SOME ERROR OCCURED");
                  return;
                });

              if (foundSentMailLabel && numOfThreads == 1) {
                status =
                  "You have sent this email & the recipient has not reverted back as of now!!";
              } else if (numOfThreads == 1) {
                // check whether the sender mail is a no-reply email address or not?
                threadMsg.from.forEach((fromEmail) => {
                  if (!fromEmail.email.includes("no-reply")) {
                    status =
                      "You have received this email and have not send anything back. You can reply to the same, if you want to";
                  } else {
                    console.log("No status due to line 378");
                    status = "";
                  }
                });
              }

              // for threads having >1 message
              else if (numOfThreads > 1) {
                status =
                  "There are more than one messages in this thread conversation. To ask further, you can reply to this one";

                threadMsg.from.forEach((fromEmail) => {
                  if (fromEmail.email.includes("no-reply")) {
                    console.log("Includes no-reply");
                    status = "";
                  }
                });
              }

              console.log(`Status is: ${status}`);

              count++;
            }

            if (status != "") {
              console.log("Sent the response as status was not empty");

              // sending back the response to the frontend
              result.push({
                subject: subject,
                initialThreadDate: initialThreadDate,
                sender: sender,
                recentThreadDate: recentThreadDate,
                participants: participants,
                status: status,
                emailContent: emailContent,
                replyToMsgId: replyToMsgId,
              });
            }
          });
        participants = "";
        emailContent = "";
      }
    });
    res.status(200).send(result);
  } catch (err) {
    console.log(err.name + ": " + err.type);
    res.status(400).send("SOME ERROR OCCURED");
  }
});

// backend handler for sending a reply to a thread
app.post("/sendReply", async (req, res) => {
  const body = req.body;

  let data = JSON.stringify({
    body: body.replyContent,
    to: [{ email: body.replyToMail }],
    reply_to_message_id: body.messageID,
  });

  // using the API call to achieve the same
  let config = {
    method: "post",
    maxBodyLength: Infinity,
    url: "https://api.nylas.com/send",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${body.accessToken}`,
    },
    data: data,
  };

  axios
    .request(config)
    .then((response) => {
      console.log(JSON.stringify(response.data));
    })
    .catch((error) => {
      console.log(error);
    });

  res.send("Successfully sent the reply! Refresh the table to see the changes");
});

/* These 2 endpoints I made for the authorization part for NON-SANDBOX account, but as Coda didn't accepted that, I used the above approach
So, just mentioning it to make you aware that I worked around each aspect of Nylas and was successful in that*/

// will be used in the NON-SANDBOX application's authorization
app.get("/connect", async (req, res) => {
  let options = {
    redirectURI: "https://nylas.glitch.me/getCode",
    scopes: ["email", "contacts"],
  };
  res.redirect(Nylas.urlForAuthentication(options));
});

// will be used in the NON-SANDBOX application's authorization
app.get("/getCode", async (req, res) => {
  console.log(`Code is: ${req.query.code}`);

  let code = req.query.code;

  // API call to exchange the code for an accessToken
  let config = {
    method: "post",
    maxBodyLength: Infinity,
    url:
      "https://api.nylas.com/oauth/token?client_id={CLIENTID}&client_secret={CLIENT_SECRET}&grant_type=authorization_code&code=" +
      code,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    data: "",
  };

  let accessToken = "";

  await axios
    .request(config)
    .then((response) => {
      console.log(JSON.stringify(response.data));
      accessToken = response.data["access_token"];

      console.log(accessToken);
      res.send(response.data);
    })
    .catch((error) => {
      console.log(error);
    });
});
