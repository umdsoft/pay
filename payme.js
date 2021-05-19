  const PAYCOM_PASSWORD = 'YOUR_API_KEY';
  

    if(req.method !== 'POST'){
        return sendResponse(RPCErrors.TransportError(), null)
    }
    //проверяем авторизацию запроса.
    if (!checkAuth(req.headers['authorization'])) {
        //если запрос авторизован возвращаем ошибку -32504
        return sendResponse(RPCErrors.AccessDeniet(), null);
    }
    const data = req.body
    const params = req.body.params

    switch (data.method){
       case 'CheckPerformTransaction': {
           return CheckPerformTransaction(params.account.order, params.amount)
        }
        break;
        case 'CreateTransaction':{
            return CreateTransaction(params)
        }
            break;
        case "PerformTransaction":{
         return PerformTransaction(params)
        }
            break;
        case 'CheckTransaction':
        {

          return CheckTransaction(params)

        }
            break;
        case "CancelTransaction":{
          return CancelTransaction(params)
        }

            break;
    }

    async function CheckPerformTransaction (id,amount){
        await Order.findOne({orderId: id},(err,data)=>{
            if(err || !data ) return sendResponse(BillingErrors.OrderNotFound(),null);
            if(data.payed === 1) return sendResponse(BillingErrors.OrderAvailable(),null);
            if(data.amount !== amount / 100)  return sendResponse(BillingErrors.IncorrectAmount(),null);
            return  sendResponse(null,{
                allow: true
            })
        })
    }
    async function CreateTransaction(param){
        await Transaction.findOne({order: param.account.order},async (err,data)=> {
            if(!data){
                await Order.findOne({orderId: param.account.order},async (err,order)=>{
                    if(err || !order ) return sendResponse(BillingErrors.OrderNotFound(),null);
                    if(order.payed === 1) return sendResponse(BillingErrors.OrderAvailable(),null);
                    if(order.amount !== param.amount / 100)  return sendResponse(BillingErrors.IncorrectAmount(),null);
                })
                const transaction = new Transaction({
                    tid: param.id,
                    amount: param.amount / 100,
                    transaction: Math.floor(Math.random() * 1000000000).toString(),
                    state: 1,
                    perform_time:0,
                    cancel_time:0,
                    create_time: Date.now(),
                    order: parseInt(param.account.order),
                    time: param.time
                })
                transaction.save()
                    .then(()=>{
                        console.log('saved')
                        return sendResponse(null,{
                            transaction: transaction.transaction,
                            state: transaction.state,
                            create_time: transaction.create_time,
                            perform_time: transaction.perform_time,
                            cancel_time:transaction.cancel_time
                        })
                    })
                    .catch((err)=>{
                        console.log(err)
                    })
            }
            if (data){
                if(param.id !== data.tid){
                    return sendResponse(BillingErrors.YesTransaction(), null);
                }
                if(data.state === 1){
                    if(data.time > param.time){
                        await Transaction.updateOne({tid: data._id},{$set:{
                                state: -1,
                                reason: 4
                            }},(err,data)=>{
                            return sendResponse(BillingErrors.UnexpectedTransactionState(),null)
                        })
                    }else{
                        return sendResponse(null,{
                            state: data.state,
                            create_time: data.create_time,
                            transaction: data.transaction,
                            perform_time: data.perform_time || 0,
                            cancel_time: data.cancel_time || 0
                        })
                    }
                } else {
                    return sendResponse(BillingErrors.UnexpectedTransactionState(),null)
                }
            }
        })


    }
    async function PerformTransaction(param){
        await Transaction.findOne({tid: param.id},async (err,transaction)=>{
            if(!transaction) return sendResponse(BillingErrors.TransactionNotFound(),null);
            if(transaction.state === 1){
                if(transaction.time > Date.now()){
                    await Transaction.updateOne(
                        {tid: param.id},
                        {$set:{
                                state: -1,
                                reason: 4
                            }}
                    )
                }
                const order = await Order.findOne({orderId: transaction.order})
                const journal = new Journal({
                    system: "payme",
                    amount: transaction.amount,
                    order: order._id
                })
                  await journal.save()

                await Order.updateOne({orderId: transaction.order},{
                    $set: {
                        payed: 1,
                        paySystem: 'payme'
                    }
                })
                await Transaction.updateOne({tid: transaction.tid},{
                    $set:{
                        state:2,
                        perform_time: Date.now()
                    }
                })
                const tt = await Transaction.findOne({tid: transaction.tid})
                return sendResponse(null,{
                    transaction: transaction.transaction,
                    perform_time: tt.perform_time,
                    state: 2
                })

            }
            if(transaction.state === 2){
                    return sendResponse(null,{
                        transaction: transaction.transaction,
                        perform_time: transaction.perform_time,
                        state: transaction.state
                    })
                } else {
                    return sendResponse(BillingErrors.UnexpectedTransactionState(),null)
                }


        })
    }
    async function CancelTransaction(param){
        await Transaction.findOne({tid: param.id},async (err,transaction)=>{
            if(err || !transaction) return sendResponse(BillingErrors.TransactionNotFound(),null);
            if(transaction.state === 1){
                await Transaction.updateOne({tid: transaction.tid},{$set:{
                    state: -1,
                    reason: param.reason,
                    cancel_time: Date.now()
                }})
                await Transaction.findOne({tid: transaction.tid},async (err,data)=>{
                    await Order.updateOne({orderId: transaction.order},{$set:{
                            payed: 0
                    }},async (err,data)=>{
                        if(err) return sendResponse(err,null)
                        const ord = await Order.find({orderId: transaction.order})
                        await Journal.findOneAndDelete({order: ord._id},(err,data)=>{
                            if(err) return sendResponse(err,null)
                        })
                        await Order.findOneAndDelete({_id: ord._id},(err,data)=>{
                            if(err) return sendResponse(err,null)
                        })
                        return sendResponse(null,{
                            state: data.state,
                            cancel_time: data.cancel_time,
                            transaction: data.transaction,
                            create_time: data.create_time,
                            perform_time: data.perform_time || 0
                        })
                    })

                })

            } else {
                if(transaction.state === 2){
                    await Order.findOne({orderId: transaction.order},async (err,order)=>{
                        if(err) return sendResponse(err,null);
                        if(order.payed === 0){
                            await Transaction.updateOne({tid: param.id},{$set:{
                                    state: -2,
                                    reason: param.reason,
                                    cancel_time: Date.now()
                            }}).exec((err,transac)=>{
                                return sendResponse(null,{
                                    state: transac.state,
                                    cancel_time: transac.cancel_time || 0,
                                    transaction: transac.transaction,
                                    create_time: transac.create_time,
                                    perform_time: transac.perform_time || 0
                                })
                            })
                        } else {
                            return sendResponse(BillingErrors.OrderNotСanceled(),null)
                        }
                    })
                } else {
                    return sendResponse(null,{
                        state: transaction.state,
                        cancel_time: transaction.cancel_time || 0,
                        transaction: transaction.transaction,
                        create_time: transaction.create_time,
                        perform_time: transaction.perform_time || 0
                    })
                }
            }
        })
    }
    async function CheckTransaction(param){
        await Transaction.findOne({tid: param.id},(err,data)=>{
            if(err || !data) return sendResponse(BillingErrors.TransactionNotFound(),null);
            return sendResponse(null,{
                create_time: data.create_time,
                perform_time: data.perform_time || 0,
                cancel_time: data.cancel_time || 0,
                transaction: data.transaction,
                state: data.state,
                reason: data.reason || null
            })
        })
    }
    function sendResponse (error, result){
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8'
        });

        res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: error || undefined,
            result: result || undefined,
            id: req.body.id
        }));
    }

    function checkAuth(auth) {
        return auth                                                             //проверяем существование заголовка
            && (auth = auth.trim().split(/ +/))                              //разделяем заголовок на 2 части
            && auth[0] === 'Basic' && auth[1]                                //проверяем правильность формата заголовка
            && ((auth = (new Buffer(auth[1], 'base64')).toString('utf-8')))  //декодируем из base64
            && (auth = auth.trim().split(/ *: */))                           //разделяем заголовок на логин пароль
            && auth[0] === 'Paycom'                                          //проверяем логин
            && auth[1] === PAYCOM_PASSWORD                                   //проверяем пароль
    }