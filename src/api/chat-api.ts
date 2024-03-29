import { Request, Router } from 'express';
import { Op, col, fn } from 'sequelize';
import { models } from '../../models';
import { DecryptAuthTokenDataMiddleware } from '../middleware/decrypt-auth-token-data-middleware';
import { TokenData } from '../utils/token-utils';
import {
  createGenericResponse,
  getCreateChatErrorResponse,
  getCreateChatFormErrors,
} from '../utils/response-utils';
import { ChatAPIMessage } from '../utils/chat-utils';
import { AuthorizationMessage } from '../utils/auth-utils';

interface CreateChatPayload {
  /**
   * The list of user ids that will be part of the user chat.
   */
  userIDs: string[];

  /**
   * The name of the user chat.
   */
  chatName: string;

  /**
   * The first message to be sent to the chat.
   */
  message: string;
}

const router = Router();
const { User, Chat, UserChat, Message, MessageRecipient } = models;

router.use(DecryptAuthTokenDataMiddleware);

// This route handles creating a group chat given the ids of users who will join the chat and returns information on
// the newly created chat.
router.post('/', async (req: Request, res) => {
  const { userID, userName } = req.tokenData as TokenData;

  const formErrors = getCreateChatFormErrors(req.body);
  if (formErrors) {
    res.status(400).json(getCreateChatErrorResponse(formErrors));
    return;
  }

  const { userIDs, chatName, message } = req.body as CreateChatPayload;
  // A list of user id's that will be part of the group chat.
  const chatUserIDs = userIDs.concat(userID);

  try {
    // Create the group chat and remember the id.
    const chatModel = await Chat.create({ name: chatName, isGroup: true });
    const chatID = chatModel.getDataValue('id');

    // Create a list of chat user records to create.
    const chatUserRecords = chatUserIDs.map(id => ({
      userID: id,
      chatID,
    }));

    // Create the message to send to the group chat and remember the id.
    const messageModel = await Message.create({
      message,
      userID,
      chatID,
    });
    const messageID = messageModel.getDataValue('id');

    // Create the user chats that will associate a user with a chat.
    const userChatModels = await UserChat.bulkCreate(chatUserRecords);
    // Create a list of message recipient records so every user in the chat can see the message.
    const messageRecipientRecords = userChatModels.map(userChatModel => ({
      userChatID: userChatModel.getDataValue('id'),
      userID: userChatModel.getDataValue('userID'),
      messageID,
    }));

    // Create a record of all message receipts for users in the chat who will receive the message.
    await MessageRecipient.bulkCreate(messageRecipientRecords);

    res.json({
      chat: {
        id: chatID,
        name: chatName,
        message: {
          author: userName,
          text: message,
          createdAt: messageModel.getDataValue('createdAt'),
        },
      },
    });
  } catch {
    res
      .status(500)
      .json(createGenericResponse(ChatAPIMessage.ERROR_CREATING_CHAT));
  }
});

// This route retrieves the all the latest messages sent to the group chats the user is part of in descending order.
router.get('/', async (req: Request, res) => {
  const { userID } = req.tokenData as TokenData;

  try {
    // Get a list of the latest message receipts for all the chats the user is part of.
    const latestMessageRecords: any = await MessageRecipient.findAll({
      raw: true,
      attributes: [
        'userChatID',
        [fn('max', col('MessageRecipient.createdAt')), 'createdAt'],
      ],
      where: { userID },
      group: ['userChatID'],
    });
    // Using the latest message receipts info we fetched for each chat, use it to retrieve the info on the message,
    // user, and chat.
    const latestChatMessageRecords = await MessageRecipient.findAll({
      raw: true,
      attributes: [],
      where: { [Op.or]: latestMessageRecords },
      order: [['createdAt', 'DESC']],
      include: [
        {
          model: Message,
          attributes: ['message', 'createdAt'],
          include: [{ model: User, attributes: ['name'] }],
        },
        {
          model: UserChat,
          attributes: [],
          include: [{ model: Chat, attributes: ['id', 'name'] }],
        },
      ],
    });
    // Using the latest message records, create a new object which will hold the necessary info on the
    const chats = latestChatMessageRecords.map((latestChatMessage: any) => ({
      name: latestChatMessage['UserChat.Chat.name'],
      id: latestChatMessage['UserChat.Chat.id'],
      message: {
        author: latestChatMessage['Message.User.name'],
        text: latestChatMessage['Message.message'],
        createdAt: latestChatMessage['Message.createdAt'],
      },
    }));

    res.json({ chats });
  } catch {
    const message = createGenericResponse(ChatAPIMessage.ERROR_FETCHING_CHAT);
    res.status(500).json(getCreateChatErrorResponse([message]));
  }
});

// This route fetches the basic info for each member of the provided chag id.
router.get('/:chatID/members', async (req: Request, res) => {
  const { userID } = req.tokenData as TokenData;
  const { chatID } = req.params;

  try {
    // Check if the user is allowed to fetch the members of the provided group chat id.
    const userChatModel = await UserChat.findOne({ where: { chatID, userID } });
    if (!userChatModel) {
      res
        .status(403)
        .json(createGenericResponse(AuthorizationMessage.UNAUTHORIZED));
      return;
    }

    // Fetch records of the members in the chat.
    const userChatMemberRecords = await UserChat.findAll({
      raw: true,
      where: { chatID },
      attributes: [],
      include: [{ model: User, attributes: ['id', 'name'] }],
    });

    // Create an object to hold the necessary info of users.
    const members = userChatMemberRecords.map((userChatMember: any) => ({
      id: userChatMember['User.id'],
      name: userChatMember['User.name'],
    }));

    res.json({ members });
  } catch {
    const message = createGenericResponse(
      ChatAPIMessage.ERROR_FETCHING_CHAT_MEMBERS
    );
    res.status(500).json(getCreateChatErrorResponse([message]));
  }
});

export default router;
